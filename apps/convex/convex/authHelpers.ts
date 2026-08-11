import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { WorkspaceRole, ChannelRole } from "@ripple/shared/enums";
import type { YjsShareRoom } from "@ripple/shared/shareTypes";

// ─── Result types ────────────────────────────────────────────────────

export interface AuthIdentity {
  userId: Id<"users">;
}

export interface WorkspaceAuth extends AuthIdentity {
  membership: Doc<"workspaceMembers">;
}

// ─── Internal building blocks ────────────────────────────────────────

type Ctx = { db: QueryCtx["db"]; auth: QueryCtx["auth"] };

/** Raw membership lookup — no auth check, for internal queries that receive userId explicitly. */
export async function getWorkspaceMembership(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<Doc<"workspaceMembers"> | null> {
  return ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .first();
}

// ─── Authentication ──────────────────────────────────────────────────

/** Returns userId or null. Thin wrapper so callers import one module. */
export async function getUser(ctx: Ctx): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

/** Authenticate + require login. Throws ConvexError if not logged in. */
export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Not authenticated");
  return userId;
}

// ─── Platform admin ──────────────────────────────────────────────────

/**
 * Authenticate + require the platform-admin flag. Throws on failure.
 * This is the single gate for the separate admin app (apps/admin); every
 * admin-only function must call it, because both frontends hit this same
 * deployment and client-side gating is only cosmetic. The flag is set manually
 * via the Convex dashboard (no mutation grants it), so it can't be self-granted.
 */
export async function requirePlatformAdmin(ctx: Ctx): Promise<Id<"users">> {
  const userId = await requireUser(ctx);
  const user = await ctx.db.get(userId);
  // `disabled` is re-checked here (not just at sign-in) so a disabled admin
  // loses access on the next request rather than lingering until their already
  // -issued access JWT expires — the session/refresh invalidation in
  // `setDisabled` doesn't revoke a live access token.
  if (!user?.isPlatformAdmin || user.disabled) throw new ConvexError("Not authorized");
  return userId;
}

/** Soft variant for queries — returns whether the caller is a platform admin. */
export async function checkPlatformAdmin(ctx: Ctx): Promise<boolean> {
  const userId = await getUser(ctx);
  if (!userId) return false;
  const user = await ctx.db.get(userId);
  return Boolean(user?.isPlatformAdmin) && !user?.disabled;
}

// ─── Workspace membership ────────────────────────────────────────────

/**
 * Authenticate + require workspace membership. Throws on failure.
 * Pass `opts.role` to require a specific role (e.g. WorkspaceRole.ADMIN).
 */
export async function requireWorkspaceMember(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  opts?: { role?: typeof WorkspaceRole.ADMIN },
): Promise<WorkspaceAuth> {
  const userId = await requireUser(ctx);
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) throw new ConvexError("Not a member of this workspace");
  if (opts?.role && membership.role !== opts.role) {
    throw new ConvexError("Insufficient permissions");
  }
  return { userId, membership };
}

/**
 * Soft variant for queries — returns null instead of throwing.
 * Use when the query should return null/[] on unauthorized.
 */
export async function checkWorkspaceMember(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceAuth | null> {
  const userId = await getUser(ctx);
  if (!userId) return null;
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) return null;
  return { userId, membership };
}

// ─── Resource access (fetch + membership in one step) ────────────────

/** Tables whose rows carry a workspaceId field. */
export type WorkspaceResource =
  | "documents"
  | "diagrams"
  | "spreadsheets"
  | "projects"
  | "tasks"
  | "cycles";

/**
 * The one place a collaborative resource's two spellings are tied together:
 * the name it goes by on the wire (room ids, tokens, snapshot blobs) and the
 * table it actually lives in.
 *
 * This mapping used to be re-derived per call site, and the copies drifted —
 * `spreadsheets` reached the token path but never the snapshot path, which is
 * how an unauthorized cross-workspace read shipped. `satisfies` makes pointing
 * a room kind at a non-workspace table a compile error, so a new resource is
 * one edit here rather than a grep.
 *
 * `presence` is deliberately absent: it is keyed by workspace id directly and
 * has no row of its own (see `hasResourceAccess`).
 */
export const COLLAB_RESOURCE_TABLES = {
  doc: "documents",
  diagram: "diagrams",
  task: "tasks",
  spreadsheet: "spreadsheets",
} as const satisfies Record<string, WorkspaceResource>;

/** Wire name of a resource that has a Yjs room. */
export type CollabResource = keyof typeof COLLAB_RESOURCE_TABLES;

/**
 * Compile-time proof that every room a guest share can point at is a room this
 * module knows how to authorize. `packages/shared` owns the shareable subset
 * and can't import Convex table names (it must not depend on the backend), so
 * this is where the two halves are pinned together: add a shareable surface in
 * `shareTypes.ts` without giving its room a table here and the build fails.
 */
type Extends<A extends B, B> = A;
type _ShareRoomsAreCollabRooms = Extends<YjsShareRoom, CollabResource>;

/** A room kind, including the workspace-level presence room. */
export type CollabRoom = CollabResource | "presence";

/**
 * The two vocabularies as runtime lists, for the callers that have to *validate*
 * a room kind off the wire rather than accept one already validated (the
 * PartyKit HTTP routes parse room ids out of a query string). Derived from the
 * map above so a new resource cannot reach the token path while the snapshot
 * path still rejects it — the drift this file already exists to prevent.
 */
export const COLLAB_RESOURCES = Object.keys(
  COLLAB_RESOURCE_TABLES,
) as CollabResource[];

export const COLLAB_ROOMS: CollabRoom[] = [...COLLAB_RESOURCES, "presence"];

/**
 * Argument validators for the two vocabularies above. Use these instead of
 * spelling the union out again — the hand-written copies had already drifted
 * apart (the token path accepted `spreadsheet`, the snapshot path did not),
 * and every such gap is a resource whose access rule is missing somewhere.
 */
export const collabResourceValidator = v.union(
  v.literal("doc"),
  v.literal("diagram"),
  v.literal("task"),
  v.literal("spreadsheet"),
);

export const collabRoomValidator = v.union(
  collabResourceValidator,
  v.literal("presence"),
);

type ResourceAccess<T extends WorkspaceResource> =
  | { ok: true; resource: Doc<T>; membership: Doc<"workspaceMembers"> }
  | { ok: false; reason: "not-found" | "not-member" };

/**
 * The workspace rule, once: a resource is reachable by the members of the
 * workspace that owns it. Every public variant below is a projection of this —
 * throwing, nullable, or boolean — so the three cannot disagree about who gets in.
 */
async function resourceAccess<T extends WorkspaceResource>(
  ctx: { db: QueryCtx["db"] },
  resourceId: Id<T>,
  userId: Id<"users">,
): Promise<ResourceAccess<T>> {
  const resource = await ctx.db.get(resourceId);
  if (!resource) return { ok: false, reason: "not-found" };

  const workspaceId = (resource as unknown as { workspaceId: Id<"workspaces"> }).workspaceId;
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) return { ok: false, reason: "not-member" };

  return { ok: true, resource, membership };
}

/**
 * Authenticate + fetch resource + verify workspace membership. Throws on failure.
 * Returns the resource alongside auth result so callers don't re-fetch.
 */
export async function requireResourceMember<T extends WorkspaceResource>(
  ctx: Ctx,
  table: T,
  resourceId: Id<T>,
  opts?: { role?: typeof WorkspaceRole.ADMIN },
): Promise<{ userId: Id<"users">; resource: Doc<T>; membership: Doc<"workspaceMembers"> }> {
  const userId = await requireUser(ctx);

  const access = await resourceAccess<T>(ctx, resourceId, userId);
  if (!access.ok) {
    throw new ConvexError(
      access.reason === "not-found"
        ? `${table.slice(0, -1)} not found`
        : "Not a member of this workspace",
    );
  }
  if (opts?.role && access.membership.role !== opts.role) {
    throw new ConvexError("Insufficient permissions");
  }

  return { userId, resource: access.resource, membership: access.membership };
}

/**
 * Soft variant — returns null if resource missing or user not a member.
 * For queries that should return null/[] on unauthorized.
 *
 * `_table` is unused at runtime (the row carries its own workspaceId) but is
 * what binds `T`, so `resourceId` is still checked against the named table at
 * every call site. Dropping the parameter would silently widen the type.
 */
export async function checkResourceMember<T extends WorkspaceResource>(
  ctx: Ctx,
  _table: T,
  resourceId: Id<T>,
): Promise<{ userId: Id<"users">; resource: Doc<T>; membership: Doc<"workspaceMembers"> } | null> {
  const userId = await getUser(ctx);
  if (!userId) return null;

  const access = await resourceAccess<T>(ctx, resourceId, userId);
  if (!access.ok) return null;

  return { userId, resource: access.resource, membership: access.membership };
}

// ─── Channel access ──────────────────────────────────────────────────

/**
 * Channel access with open/closed/dm branching.
 * Pass `opts.role` to require admin:
 *   - Closed/DM channel: requires ChannelRole.ADMIN in channelMembers
 *   - Open channel: requires WorkspaceRole.ADMIN in workspaceMembers
 */
export async function requireChannelAccess(
  ctx: Ctx,
  channelId: Id<"channels">,
  opts?: { role?: typeof ChannelRole.ADMIN },
): Promise<{
  userId: Id<"users">;
  channel: Doc<"channels">;
  workspaceMembership: Doc<"workspaceMembers">;
  channelMembership: Doc<"channelMembers"> | null;
}> {
  const userId = await requireUser(ctx);

  const channel = await ctx.db.get(channelId);
  if (!channel) throw new ConvexError("Channel not found");

  const workspaceMembership = await getWorkspaceMembership(ctx, channel.workspaceId, userId);
  if (!workspaceMembership) throw new ConvexError("Not a member of this workspace");

  let channelMembership: Doc<"channelMembers"> | null = null;

  if (channel.type !== "open") {
    channelMembership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();

    if (!channelMembership) throw new ConvexError("Not a member of this channel");

    if (opts?.role && channelMembership.role !== opts.role) {
      throw new ConvexError("Not authorized");
    }
  } else if (opts?.role) {
    if (workspaceMembership.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Not authorized");
    }
  }

  return { userId, channel, workspaceMembership, channelMembership };
}

/**
 * Soft variant of `requireChannelAccess` — returns null instead of throwing,
 * for queries that should degrade to `[]`/null rather than error. Same rule,
 * same branching; the only difference is the failure mode.
 *
 * Use this rather than hand-rolling a `requireUser` check and reading the
 * channel's rows anyway — that is the "third access rule" the codebase does
 * not have.
 */
export async function checkChannelAccess(
  ctx: Ctx,
  channelId: Id<"channels">,
): Promise<{
  userId: Id<"users">;
  channel: Doc<"channels">;
  workspaceMembership: Doc<"workspaceMembers">;
  channelMembership: Doc<"channelMembers"> | null;
} | null> {
  const userId = await getUser(ctx);
  if (!userId) return null;

  const channel = await ctx.db.get(channelId);
  if (!channel) return null;

  const workspaceMembership = await getWorkspaceMembership(ctx, channel.workspaceId, userId);
  if (!workspaceMembership) return null;

  let channelMembership: Doc<"channelMembers"> | null = null;
  if (channel.type !== "open") {
    channelMembership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();
    if (!channelMembership) return null;
  }

  return { userId, channel, workspaceMembership, channelMembership };
}

// ─── Creator-only ────────────────────────────────────────────────────

/** Verify the authenticated user is the creator of a resource. Throws on mismatch. */
export function requireCreator(
  resource: { creatorId: Id<"users"> },
  userId: Id<"users">,
): void {
  if (resource.creatorId !== userId) {
    throw new ConvexError("Only the creator can perform this action");
  }
}

// ─── Collaboration access (unified) ─────────────────────────────────

/**
 * Single function replacing the 5 near-identical collaboration check queries.
 * For use inside internalQuery handlers where userId is passed explicitly.
 */
export async function hasResourceAccess(
  ctx: { db: QueryCtx["db"] },
  userId: Id<"users">,
  resourceType: CollabRoom,
  resourceId: string,
): Promise<boolean> {
  if (resourceType === "presence") {
    // Presence rooms are keyed by workspace id directly — there is no row.
    const member = await getWorkspaceMembership(
      ctx,
      resourceId as Id<"workspaces">,
      userId,
    );
    return member !== null;
  }

  type Table = (typeof COLLAB_RESOURCE_TABLES)[typeof resourceType];
  const access = await resourceAccess<Table>(ctx, resourceId as Id<Table>, userId);
  return access.ok;
}

