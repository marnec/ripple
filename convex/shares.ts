import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import {
  requireUser,
  requireWorkspaceMember,
  hasGuestShareAccess,
} from "./authHelpers";
import { signToken } from "./tokenSigning";
import { rateLimiter } from "./rateLimits";
import { WorkspaceRole } from "@shared/enums";
import {
  GUEST_SUB_PREFIX,
  isValidAccessLevelForResource,
  yjsResourceTypeForShare,
  type ShareAccessLevel,
  type ShareResourceType,
} from "@shared/shareTypes";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const shareResourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("channel"),
);

const shareAccessLevelValidator = v.union(
  v.literal("view"),
  v.literal("edit"),
  v.literal("join"),
);

const shareRowValidator = v.object({
  _id: v.id("resourceShares"),
  _creationTime: v.number(),
  shareId: v.string(),
  resourceType: shareResourceTypeValidator,
  resourceId: v.string(),
  workspaceId: v.id("workspaces"),
  accessLevel: shareAccessLevelValidator,
  createdBy: v.id("users"),
  createdAt: v.number(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const TOKEN_TTL_MS = 5 * 60 * 1000;
const GUEST_NAME_MIN = 1;
const GUEST_NAME_MAX = 40;
const GUEST_SUB_MAX = 64;

/** 16 random bytes → 22-char base64url identifier. Collision risk ≈ nil. */
function generateShareId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sanitizeGuestName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < GUEST_NAME_MIN || trimmed.length > GUEST_NAME_MAX) {
    throw new ConvexError("Guest name must be 1-40 characters");
  }
  return trimmed;
}

function sanitizeGuestSub(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > GUEST_SUB_MAX) {
    throw new ConvexError("Invalid guest session id");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ConvexError("Invalid guest session id");
  }
  return trimmed;
}

function isShareActive(share: Doc<"resourceShares">, now: number): boolean {
  if (share.revokedAt !== undefined) return false;
  if (share.expiresAt !== undefined && share.expiresAt <= now) return false;
  return true;
}

/**
 * Resolve the workspaceId that owns a resource — used when an admin creates
 * a share link, so we can confirm they are an admin of the owning workspace.
 */
async function resolveResourceWorkspaceId(
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<Id<"workspaces">> {
  if (resourceType === "channel") {
    const channel = await ctx.db.get(resourceId as Id<"channels">);
    if (!channel) throw new ConvexError("Channel not found");
    return channel.workspaceId;
  }
  // All three share-eligible tables have `workspaceId` — one cast is enough.
  const resource = await ctx.db.get(resourceId as Id<"documents">);
  if (!resource) throw new ConvexError(`${resourceType} not found`);
  return (resource as { workspaceId: Id<"workspaces"> }).workspaceId;
}

async function loadShareByShareId(
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  shareId: string,
): Promise<Doc<"resourceShares"> | null> {
  return ctx.db
    .query("resourceShares")
    .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
    .unique();
}

// ---------------------------------------------------------------------------
// Admin-only mutations / queries
// ---------------------------------------------------------------------------

export const createShare = mutation({
  args: {
    resourceType: shareResourceTypeValidator,
    resourceId: v.string(),
    accessLevel: shareAccessLevelValidator,
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({ shareId: v.string() }),
  handler: async (ctx, { resourceType, resourceId, accessLevel, expiresAt }) => {
    if (!isValidAccessLevelForResource(resourceType, accessLevel)) {
      throw new ConvexError(
        `Access level "${accessLevel}" is not valid for a ${resourceType} share`,
      );
    }

    const workspaceId = await resolveResourceWorkspaceId(
      ctx,
      resourceType,
      resourceId,
    );

    await requireWorkspaceMember(ctx, workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    const now = Date.now();
    if (expiresAt !== undefined && expiresAt <= now) {
      throw new ConvexError("Expiry must be in the future");
    }

    const userId = await requireUser(ctx);

    // Retry on the astronomically unlikely shareId collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const shareId = generateShareId();
      const existing = await loadShareByShareId(ctx, shareId);
      if (existing) continue;
      await ctx.db.insert("resourceShares", {
        shareId,
        resourceType,
        resourceId,
        workspaceId,
        accessLevel,
        createdBy: userId,
        createdAt: now,
        expiresAt,
      });
      return { shareId };
    }
    throw new ConvexError("Failed to allocate share id");
  },
});

export const listSharesForResource = query({
  args: {
    resourceType: shareResourceTypeValidator,
    resourceId: v.string(),
  },
  returns: v.array(shareRowValidator),
  handler: async (ctx, { resourceType, resourceId }) => {
    const workspaceId = await resolveResourceWorkspaceId(
      ctx,
      resourceType,
      resourceId,
    );
    await requireWorkspaceMember(ctx, workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    return await ctx.db
      .query("resourceShares")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", resourceId),
      )
      .collect();
  },
});

export const revokeShare = mutation({
  args: { shareId: v.string() },
  returns: v.null(),
  handler: async (ctx, { shareId }) => {
    const share = await loadShareByShareId(ctx, shareId);
    if (!share) throw new ConvexError("Share not found");

    await requireWorkspaceMember(ctx, share.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (share.revokedAt === undefined) {
      await ctx.db.patch(share._id, { revokedAt: Date.now() });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Public guest-facing queries / actions (no auth)
// ---------------------------------------------------------------------------

const shareStatusValidator = v.union(
  v.literal("active"),
  v.literal("expired"),
  v.literal("revoked"),
  v.literal("not_found"),
);

export const getShareInfo = query({
  args: { shareId: v.string() },
  returns: v.object({
    status: shareStatusValidator,
    resourceType: v.optional(shareResourceTypeValidator),
    resourceId: v.optional(v.string()),
    resourceName: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    accessLevel: v.optional(shareAccessLevelValidator),
  }),
  handler: async (ctx, { shareId }) => {
    const share = await loadShareByShareId(ctx, shareId);
    if (!share) return { status: "not_found" as const };

    const now = Date.now();
    if (share.revokedAt !== undefined) {
      return { status: "revoked" as const };
    }
    if (share.expiresAt !== undefined && share.expiresAt <= now) {
      return { status: "expired" as const };
    }

    let resourceName: string;
    if (share.resourceType === "channel") {
      const channel = await ctx.db.get(share.resourceId as Id<"channels">);
      if (!channel) return { status: "not_found" as const };
      resourceName = channel.name;
    } else {
      const resource = await ctx.db.get(share.resourceId as Id<"documents">);
      if (!resource) return { status: "not_found" as const };
      resourceName = (resource as { name?: string }).name ?? "";
    }

    const workspace = await ctx.db.get(share.workspaceId);

    return {
      status: "active" as const,
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      resourceName,
      workspaceName: workspace?.name ?? "",
      accessLevel: share.accessLevel,
    };
  },
});

// ─── internal helpers used from actions ──────────────────────────────────

export const bumpLastUsed = internalMutation({
  args: { shareId: v.string() },
  returns: v.null(),
  handler: async (ctx, { shareId }) => {
    const share = await loadShareByShareId(ctx, shareId);
    if (share) {
      await ctx.db.patch(share._id, { lastUsedAt: Date.now() });
    }
    return null;
  },
});

const activeShareResultValidator = v.union(
  v.null(),
  v.object({
    resourceType: shareResourceTypeValidator,
    resourceId: v.string(),
    workspaceId: v.id("workspaces"),
    accessLevel: shareAccessLevelValidator,
  }),
);

/**
 * Load a share AND verify its target resource still exists. Cascade-delete
 * removes share rows when the resource is deleted, but a mid-transaction
 * race could still let a deleted resource slip through — the existence
 * check is defence-in-depth.
 */
export const loadActiveShare = internalQuery({
  args: { shareId: v.string() },
  returns: activeShareResultValidator,
  handler: async (ctx, { shareId }) => {
    const share = await loadShareByShareId(ctx, shareId);
    if (!share) return null;
    if (!isShareActive(share, Date.now())) return null;

    const resource =
      share.resourceType === "channel"
        ? await ctx.db.get(share.resourceId as Id<"channels">)
        : await ctx.db.get(share.resourceId as Id<"documents">);
    if (!resource) return null;

    return {
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      workspaceId: share.workspaceId,
      accessLevel: share.accessLevel,
    };
  },
});

/** Periodic re-check used by partyserver for connected guests. */
export const checkGuestAccess = internalQuery({
  args: {
    shareId: v.string(),
    resourceType: v.union(
      v.literal("doc"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
    ),
    resourceId: v.string(),
    accessLevel: v.optional(shareAccessLevelValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { shareId, resourceType, resourceId, accessLevel }) => {
    const shareResourceType: ShareResourceType =
      resourceType === "doc"
        ? "document"
        : resourceType === "diagram"
          ? "diagram"
          : "spreadsheet";
    return hasGuestShareAccess(
      ctx,
      shareId,
      shareResourceType,
      resourceId,
      accessLevel,
    );
  },
});

// ─── token issuance ─────────────────────────────────────────────────────

export const getGuestCollaborationToken = action({
  args: {
    shareId: v.string(),
    guestName: v.string(),
    guestSub: v.string(),
  },
  returns: v.object({
    token: v.string(),
    roomId: v.string(),
    guestSub: v.string(),
  }),
  handler: async (ctx, { shareId, guestName, guestSub }) => {
    const secret = process.env.PARTYKIT_SECRET;
    if (!secret) {
      throw new ConvexError("Server configuration error: PARTYKIT_SECRET not set");
    }

    const name = sanitizeGuestName(guestName);
    const sub = sanitizeGuestSub(guestSub);

    // Per-link limit first (cheap, keyed by shareId). Throws on bust.
    await rateLimiter.limit(ctx, "guestShareCollabToken", {
      key: shareId,
      throws: true,
    });

    const share = await ctx.runQuery(internal.shares.loadActiveShare, {
      shareId,
    });
    if (!share) throw new ConvexError("Share is not active");

    // Per-workspace ceiling (runs after share load so we know the workspace).
    await rateLimiter.limit(ctx, "guestShareCollabTokenWorkspace", {
      key: share.workspaceId,
      throws: true,
    });

    const yjsType = yjsResourceTypeForShare(share.resourceType);
    if (!yjsType) {
      throw new ConvexError("This share is not for a collaborative document");
    }
    if (share.accessLevel !== "view" && share.accessLevel !== "edit") {
      throw new ConvexError("This share does not grant document access");
    }

    const roomId = `${yjsType}-${share.resourceId}`;
    const fullSub = `${GUEST_SUB_PREFIX}${sub}`;

    const token = await signToken(
      {
        sub: fullSub,
        name,
        img: null,
        room: roomId,
        exp: Date.now() + TOKEN_TTL_MS,
        isGuest: true,
        accessLevel: share.accessLevel,
        shareId,
      },
      secret,
    );

    await ctx.runMutation(internal.shares.bumpLastUsed, { shareId });

    return { token, roomId, guestSub: sub };
  },
});

export const getGuestCallToken = action({
  args: {
    shareId: v.string(),
    guestName: v.string(),
    guestSub: v.string(),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
    guestSub: v.string(),
    channelId: v.id("channels"),
  }),
  handler: async (ctx, { shareId, guestName, guestSub }) => {
    const name = sanitizeGuestName(guestName);
    const sub = sanitizeGuestSub(guestSub);

    // Gate BEFORE the Cloudflare fetch — every call burns RTK quota.
    await rateLimiter.limit(ctx, "guestShareCallToken", {
      key: shareId,
      throws: true,
    });

    const share = await ctx.runQuery(internal.shares.loadActiveShare, {
      shareId,
    });
    if (!share) throw new ConvexError("Share is not active");
    if (share.resourceType !== "channel" || share.accessLevel !== "join") {
      throw new ConvexError("This share does not grant call access");
    }

    await rateLimiter.limit(ctx, "guestShareCallTokenWorkspace", {
      key: share.workspaceId,
      throws: true,
    });

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const appId = process.env.CLOUDFLARE_RTK_APP_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !appId || !apiToken) {
      throw new ConvexError(
        "Missing Cloudflare RealtimeKit environment variables",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const channelId = share.resourceId as Id<"channels">;

    const session = await ctx.runQuery(internal.callSessions.getActiveSession, {
      channelId,
    });

    let meetingId: string;
    if (session) {
      meetingId = session.cloudflareMeetingId;
    } else {
      const createRes = await fetch(
        `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ title: `Channel call ${channelId}` }),
        },
      );
      if (!createRes.ok) {
        const err = await createRes.text();
        console.error("Cloudflare create-meeting failed:", createRes.status, err);
        throw new ConvexError("Could not start the call");
      }
      const createData = (await createRes.json()) as { data: { id: string } };
      meetingId = createData.data.id;

      const existingMeetingId = await ctx.runMutation(
        internal.callSessions.createSession,
        { channelId, cloudflareMeetingId: meetingId },
      );
      if (existingMeetingId) meetingId = existingMeetingId;
    }

    const fullSub = `${GUEST_SUB_PREFIX}${sub}`;
    const participantRes = await fetch(
      `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          preset_name: "group_call_participant",
          custom_participant_id: fullSub,
        }),
      },
    );
    if (!participantRes.ok) {
      const err = await participantRes.text();
      console.error("Cloudflare add-participant failed:", participantRes.status, err);
      throw new ConvexError("Could not join the call");
    }

    const participantData = (await participantRes.json()) as {
      data: { token: string };
    };

    await ctx.runMutation(internal.shares.bumpLastUsed, { shareId });

    return {
      authToken: participantData.data.token,
      meetingId,
      guestSub: sub,
      channelId,
    };
  },
});

export type { ShareAccessLevel };
