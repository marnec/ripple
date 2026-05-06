import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  getWorkspaceMembership,
  requireChannelAccess,
  requireUser,
  requireWorkspaceMember,
} from "./authHelpers";
import { logActivity } from "./auditLog";
import { notify } from "./utils/notify";
import { rateLimiter } from "./rateLimits";
import { CF_API_BASE, ensureMeetingForChannel } from "./callSessions";
import { GUEST_SUB_PREFIX } from "@ripple/shared/shareTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const MAX_INVITEES = 200;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const JOIN_WINDOW_LEAD_MS = 5 * 60 * 1000; // join allowed from start − 5 min
const JOIN_WINDOW_TAIL_MS = 15 * 60 * 1000; // until end + 15 min
const SHARE_BUFFER_MS = 24 * 60 * 60 * 1000; // share expires endsAt + 24h
const GUEST_NAME_MIN = 1;
const GUEST_NAME_MAX = 40;
const GUEST_SUB_MAX = 64;
// Simple practical email regex — server-side validation only filters obvious
// junk; real deliverability is verified by the email provider.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RSVP_STATUSES = ["pending", "accepted", "declined", "tentative"] as const;

const rsvpStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("tentative"),
);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const eventValidator = v.object({
  _id: v.id("calendarEvents"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  title: v.string(),
  description: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  timezone: v.string(),
  channelId: v.optional(v.id("channels")),
  cloudflareMeetingId: v.optional(v.string()),
  createdBy: v.id("users"),
  cancelledAt: v.optional(v.number()),
});

const inviteeValidator = v.object({
  _id: v.id("calendarEventInvitees"),
  _creationTime: v.number(),
  eventId: v.id("calendarEvents"),
  workspaceId: v.id("workspaces"),
  userId: v.optional(v.id("users")),
  guestEmail: v.optional(v.string()),
  guestName: v.optional(v.string()),
  guestSub: v.optional(v.string()),
  status: rsvpStatusValidator,
  respondedAt: v.optional(v.number()),
  shareId: v.optional(v.string()),
  // Denormalized for cheap rendering in EventDetailSheet (avoids a per-row
  // join on the client). Filled by the resolver, never persisted.
  userName: v.optional(v.string()),
  userImage: v.optional(v.string()),
  userEmail: v.optional(v.string()),
});

const eventWithInviteesValidator = v.object({
  event: eventValidator,
  invitees: v.array(inviteeValidator),
  organizer: v.object({
    userId: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
  }),
  channelName: v.optional(v.string()),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateShareId(): string {
  // 16 random bytes → 22-char base64url, mirrors shares.ts.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateGuestSub(): string {
  // Stable per-invitee identifier — used as Cloudflare custom_participant_id
  // so reconnects are recognised. 12 bytes is plenty: invitees per event are
  // bounded and the value never escapes the server-issued participant token.
  const bytes = new Uint8Array(12);
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

function sanitizeGuestSubInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > GUEST_SUB_MAX) {
    throw new ConvexError("Invalid guest session id");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ConvexError("Invalid guest session id");
  }
  return trimmed;
}

function normalizeEmail(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(t)) {
    throw new ConvexError(`Invalid email address: ${raw}`);
  }
  return t;
}

function validateTimes(startsAt: number, endsAt: number): void {
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    throw new ConvexError("Invalid event time");
  }
  if (endsAt <= startsAt) {
    throw new ConvexError("Event end must be after start");
  }
  if (endsAt - startsAt > MAX_DURATION_MS) {
    throw new ConvexError("Event duration cannot exceed 24 hours");
  }
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new ConvexError("Title is required");
  if (trimmed.length > TITLE_MAX) {
    throw new ConvexError(`Title must be ${TITLE_MAX} characters or fewer`);
  }
  return trimmed;
}

function validateDescription(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  if (description.length > DESCRIPTION_MAX) {
    throw new ConvexError(`Description must be ${DESCRIPTION_MAX} characters or fewer`);
  }
  return description;
}

function isInJoinWindow(
  event: { startsAt: number; endsAt: number; cancelledAt?: number },
  now: number,
): boolean {
  if (event.cancelledAt !== undefined) return false;
  return (
    now >= event.startsAt - JOIN_WINDOW_LEAD_MS &&
    now <= event.endsAt + JOIN_WINDOW_TAIL_MS
  );
}

/** Throws unless the given user is the event creator OR has an invitee row. */
async function requireEventViewer(
  ctx: { db: import("./_generated/server").QueryCtx["db"]; auth: import("./_generated/server").QueryCtx["auth"] },
  eventId: Id<"calendarEvents">,
): Promise<{ userId: Id<"users">; event: Doc<"calendarEvents"> }> {
  const userId = await requireUser(ctx);
  const event = await ctx.db.get(eventId);
  if (!event) throw new ConvexError("Event not found");
  if (event.createdBy === userId) return { userId, event };
  const invitee = await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_event_user", (q) =>
      q.eq("eventId", eventId).eq("userId", userId),
    )
    .first();
  if (!invitee) throw new ConvexError("Not authorized to view this event");
  return { userId, event };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Events visible to the current user in [rangeStartMs, rangeEndMs).
 * "Visible" = creator OR has an invitee row. Intersection is partial:
 * an event is included if any of its time falls in the window.
 */
export const listMineInRange = query({
  args: {
    workspaceId: v.id("workspaces"),
    rangeStartMs: v.number(),
    rangeEndMs: v.number(),
  },
  returns: v.array(eventValidator),
  handler: async (ctx, { workspaceId, rangeStartMs, rangeEndMs }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    if (rangeEndMs <= rangeStartMs) return [];

    // Two scans: events I created + events I'm invited to. Dedupe by _id.
    // Both scans range-filter on startsAt for cheap pre-filter, then
    // cross-check endsAt > rangeStartMs so we keep events that started
    // before the window but end inside it.
    const created = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_starts", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .gte("startsAt", rangeStartMs - MAX_DURATION_MS)
          .lt("startsAt", rangeEndMs),
      )
      .collect();

    const invited = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_user_workspace_event", (q) =>
        q.eq("userId", userId).eq("workspaceId", workspaceId),
      )
      .collect();

    const eventIds = new Set<Id<"calendarEvents">>();
    const events: Doc<"calendarEvents">[] = [];

    const pushIfRelevant = (e: Doc<"calendarEvents">) => {
      if (eventIds.has(e._id)) return;
      // Window intersection.
      if (e.endsAt <= rangeStartMs) return;
      if (e.startsAt >= rangeEndMs) return;
      eventIds.add(e._id);
      events.push(e);
    };

    for (const e of created) {
      if (e.createdBy === userId) pushIfRelevant(e);
    }
    for (const row of invited) {
      const e = await ctx.db.get(row.eventId);
      if (e && e.workspaceId === workspaceId) pushIfRelevant(e);
    }

    events.sort((a, b) => a.startsAt - b.startsAt);
    return events;
  },
});

export const get = query({
  args: { eventId: v.id("calendarEvents") },
  returns: eventWithInviteesValidator,
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventViewer(ctx, eventId);

    const inviteeRows = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    // Denormalize user fields for cheap rendering.
    const invitees = await Promise.all(
      inviteeRows.map(async (row) => {
        if (row.userId) {
          const user = await ctx.db.get(row.userId);
          return {
            ...row,
            userName: user?.name ?? undefined,
            userEmail: user?.email ?? undefined,
            userImage: user?.image ?? undefined,
          };
        }
        return { ...row };
      }),
    );

    const organizerDoc = await ctx.db.get(event.createdBy);
    const organizer = {
      userId: event.createdBy,
      name: organizerDoc?.name ?? undefined,
      email: organizerDoc?.email ?? undefined,
      image: organizerDoc?.image ?? undefined,
    };

    let channelName: string | undefined;
    if (event.channelId) {
      const channel = await ctx.db.get(event.channelId);
      channelName = channel?.name;
    }

    return { event, invitees, organizer, channelName };
  },
});

/**
 * Public (no-auth) lookup for guest landing — fetches event details given
 * a share token. Refuses cancelled events / non-event shares / revoked
 * shares. Does NOT return the full invitee list to guests; only their own
 * RSVP state.
 */
export const getByShareId = query({
  args: { shareId: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("revoked"),
      v.literal("not_found"),
    ),
    event: v.optional(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        startsAt: v.number(),
        endsAt: v.number(),
        timezone: v.string(),
        organizerName: v.optional(v.string()),
        workspaceName: v.optional(v.string()),
      }),
    ),
    invitee: v.optional(
      v.object({
        status: rsvpStatusValidator,
        guestName: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, { shareId }) => {
    const share = await ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first();
    if (!share) return { status: "not_found" as const };
    if (share.resourceType !== "calendarEvent") {
      return { status: "not_found" as const };
    }
    if (share.revokedAt !== undefined) return { status: "revoked" as const };
    const now = Date.now();
    if (share.expiresAt !== undefined && share.expiresAt <= now) {
      return { status: "expired" as const };
    }

    const event = await ctx.db.get(share.resourceId as Id<"calendarEvents">);
    if (!event) return { status: "not_found" as const };
    if (event.cancelledAt !== undefined) return { status: "revoked" as const };

    const organizer = await ctx.db.get(event.createdBy);
    const workspace = await ctx.db.get(event.workspaceId);

    const inviteeRow = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_share", (q) => q.eq("shareId", shareId))
      .first();

    return {
      status: "active" as const,
      event: {
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        organizerName: organizer?.name ?? undefined,
        workspaceName: workspace?.name ?? undefined,
      },
      invitee: inviteeRow
        ? {
            status: inviteeRow.status,
            guestName: inviteeRow.guestName,
          }
        : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.string(),
    channelId: v.optional(v.id("channels")),
    invitees: v.object({
      userIds: v.array(v.id("users")),
      guestEmails: v.array(v.string()),
    }),
  },
  returns: v.id("calendarEvents"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);
    if (args.channelId) {
      const channelAccess = await requireChannelAccess(ctx, args.channelId);
      if (channelAccess.channel.workspaceId !== args.workspaceId) {
        throw new ConvexError("Channel is not in this workspace");
      }
    }

    const title = validateTitle(args.title);
    const description = validateDescription(args.description);
    validateTimes(args.startsAt, args.endsAt);

    // Normalize invitees: drop duplicates, exclude organizer self-invite,
    // verify all userIds belong to the workspace.
    const userIds = Array.from(new Set(args.invitees.userIds)).filter(
      (id) => id !== userId,
    );
    const guestEmails = Array.from(
      new Set(args.invitees.guestEmails.map(normalizeEmail)),
    );
    if (userIds.length + guestEmails.length > MAX_INVITEES) {
      throw new ConvexError(`Cannot invite more than ${MAX_INVITEES} people`);
    }
    for (const uid of userIds) {
      const m = await getWorkspaceMembership(ctx, args.workspaceId, uid);
      if (!m) throw new ConvexError("Invitee is not a member of this workspace");
    }

    // Insert event.
    const eventId = await ctx.db.insert("calendarEvents", {
      workspaceId: args.workspaceId,
      title,
      description,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      timezone: args.timezone,
      channelId: args.channelId,
      createdBy: userId,
    });

    // Insert internal-member invitee rows.
    for (const uid of userIds) {
      await ctx.db.insert("calendarEventInvitees", {
        eventId,
        workspaceId: args.workspaceId,
        userId: uid,
        status: "pending",
      });
    }

    // Insert guest invitees + share rows + schedule emails.
    const now = Date.now();
    const inviter = await ctx.db.get(userId);
    const inviterName = inviter?.name ?? inviter?.email ?? "Someone";

    for (const email of guestEmails) {
      const shareId = await insertGuestShare(ctx, {
        eventId,
        workspaceId: args.workspaceId,
        createdBy: userId,
        expiresAt: args.endsAt + SHARE_BUFFER_MS,
      });
      const guestSub = generateGuestSub();
      await ctx.db.insert("calendarEventInvitees", {
        eventId,
        workspaceId: args.workspaceId,
        guestEmail: email,
        guestSub,
        status: "pending",
        shareId,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendEventInvite, {
        shareId,
        recipientEmail: email,
        inviterName,
        eventTitle: title,
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        timezone: args.timezone,
      });
    }

    // Notify in-app for internal invitees (targeted preference path).
    // No `resourceId` — calendar events have no per-resource preference
    // scope (preferences live at the workspace level only).
    if (userIds.length > 0) {
      await notify(ctx, {
        category: "eventInvited",
        userId,
        userName: inviterName,
        title: "Calendar invitation",
        body: `${inviterName} invited you to ${title}`,
        url: `/workspaces/${args.workspaceId}/dashboard/calendar?event=${eventId}`,
        recipientIds: userIds,
      });
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: eventId,
      action: "created",
      resourceName: title,
      scope: args.workspaceId,
    });

    return eventId;
  },
});

export const update = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    channelId: v.optional(v.union(v.id("channels"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found");
    if (event.createdBy !== userId) {
      throw new ConvexError("Only the organizer can edit this event");
    }
    if (event.cancelledAt !== undefined) {
      throw new ConvexError("Cannot edit a cancelled event");
    }

    const patch: Partial<Doc<"calendarEvents">> = {};
    if (args.title !== undefined) patch.title = validateTitle(args.title);
    if (args.description !== undefined) {
      patch.description = validateDescription(args.description);
    }
    const newStart = args.startsAt ?? event.startsAt;
    const newEnd = args.endsAt ?? event.endsAt;
    if (args.startsAt !== undefined || args.endsAt !== undefined) {
      validateTimes(newStart, newEnd);
      patch.startsAt = newStart;
      patch.endsAt = newEnd;
    }
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.channelId !== undefined) {
      if (args.channelId === null) {
        patch.channelId = undefined;
      } else {
        const ca = await requireChannelAccess(ctx, args.channelId);
        if (ca.channel.workspaceId !== event.workspaceId) {
          throw new ConvexError("Channel is not in this workspace");
        }
        patch.channelId = args.channelId;
      }
    }

    await ctx.db.patch(event._id, patch);

    // Notify invitees about the change.
    const recipients = await collectInternalRecipientIds(ctx, event._id);
    if (recipients.length > 0) {
      const inviter = await ctx.db.get(userId);
      const inviterName = inviter?.name ?? inviter?.email ?? "Someone";
      await notify(ctx, {
        category: "eventUpdated",
        userId,
        userName: inviterName,
        title: "Calendar event updated",
        body: `${inviterName} updated ${patch.title ?? event.title}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: recipients,
      });
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: event._id,
      action: "updated",
      resourceName: patch.title ?? event.title,
      scope: event.workspaceId,
    });

    return null;
  },
});

export const cancel = mutation({
  args: { eventId: v.id("calendarEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    if (event.createdBy !== userId) {
      throw new ConvexError("Only the organizer can cancel this event");
    }
    if (event.cancelledAt !== undefined) return null;

    const now = Date.now();
    await ctx.db.patch(event._id, { cancelledAt: now });

    // Revoke all guest share rows tied to this event.
    const guestInvitees = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    for (const row of guestInvitees) {
      if (!row.shareId) continue;
      const share = await ctx.db
        .query("resourceShares")
        .withIndex("by_shareId", (q) => q.eq("shareId", row.shareId!))
        .first();
      if (share && share.revokedAt === undefined) {
        await ctx.db.patch(share._id, { revokedAt: now });
      }
    }

    const inviter = await ctx.db.get(userId);
    const inviterName = inviter?.name ?? inviter?.email ?? "Someone";

    // Notify invited members.
    const recipients = guestInvitees
      .map((r) => r.userId)
      .filter((id): id is Id<"users"> => id !== undefined);
    if (recipients.length > 0) {
      await notify(ctx, {
        category: "eventCancelled",
        userId,
        userName: inviterName,
        title: "Calendar event cancelled",
        body: `${inviterName} cancelled ${event.title}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar`,
        recipientIds: recipients,
      });
    }

    // Schedule cancellation emails to guests (one per shareId).
    for (const row of guestInvitees) {
      if (!row.shareId || !row.guestEmail) continue;
      await ctx.scheduler.runAfter(0, internal.emails.sendEventCancellation, {
        eventTitle: event.title,
        recipientEmail: row.guestEmail,
        inviterName,
      });
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: event._id,
      action: "cancelled",
      resourceName: event.title,
      scope: event.workspaceId,
    });

    return null;
  },
});

export const respond = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    status: rsvpStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, { eventId, status }) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    if (event.cancelledAt !== undefined) {
      throw new ConvexError("Event is cancelled");
    }

    const invitee = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event_user", (q) =>
        q.eq("eventId", eventId).eq("userId", userId),
      )
      .first();
    if (!invitee) throw new ConvexError("You are not invited to this event");

    if (invitee.status === status) return null;
    await ctx.db.patch(invitee._id, { status, respondedAt: Date.now() });

    // Notify the organizer (skip self-RSVP).
    if (event.createdBy !== userId) {
      const responder = await ctx.db.get(userId);
      const name = responder?.name ?? responder?.email ?? "Someone";
      await notify(ctx, {
        category: "eventResponseChanged",
        userId,
        userName: name,
        title: "Event RSVP",
        body: `${name} ${status} your invitation to ${event.title}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: [event.createdBy],
      });
    }

    return null;
  },
});

export const respondAsGuest = mutation({
  args: {
    shareId: v.string(),
    status: rsvpStatusValidator,
    guestName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { shareId, status, guestName }) => {
    const name = sanitizeGuestName(guestName);
    const share = await ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first();
    if (!share) throw new ConvexError("Invitation link not found");
    if (share.resourceType !== "calendarEvent") {
      throw new ConvexError("Invalid invitation link");
    }
    if (share.revokedAt !== undefined) {
      throw new ConvexError("Invitation has been revoked");
    }
    const now = Date.now();
    if (share.expiresAt !== undefined && share.expiresAt <= now) {
      throw new ConvexError("Invitation has expired");
    }

    const invitee = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_share", (q) => q.eq("shareId", shareId))
      .first();
    if (!invitee) throw new ConvexError("Invitee record not found");

    const event = await ctx.db.get(invitee.eventId);
    if (!event || event.cancelledAt !== undefined) {
      throw new ConvexError("Event is no longer scheduled");
    }

    await ctx.db.patch(invitee._id, {
      status,
      respondedAt: now,
      guestName: name,
    });

    // Notify organizer.
    await notify(ctx, {
      category: "eventResponseChanged",
      userId: event.createdBy,
      userName: name,
      title: "Event RSVP",
      body: `${name} (guest) ${status} your invitation to ${event.title}`,
      url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
      recipientIds: [event.createdBy],
    });

    return null;
  },
});

export const addInvitees = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    userIds: v.array(v.id("users")),
    guestEmails: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found");
    if (event.createdBy !== userId) {
      throw new ConvexError("Only the organizer can add invitees");
    }
    if (event.cancelledAt !== undefined) {
      throw new ConvexError("Cannot add invitees to a cancelled event");
    }

    // Existing invitees — used to filter duplicates.
    const existing = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const existingUsers = new Set(
      existing.map((r) => r.userId).filter((u): u is Id<"users"> => u !== undefined),
    );
    const existingEmails = new Set(
      existing.map((r) => r.guestEmail).filter((e): e is string => e !== undefined),
    );

    const newUsers = Array.from(new Set(args.userIds))
      .filter((u) => u !== userId && !existingUsers.has(u));
    const newEmails = Array.from(new Set(args.guestEmails.map(normalizeEmail)))
      .filter((e) => !existingEmails.has(e));

    if (existing.length + newUsers.length + newEmails.length > MAX_INVITEES) {
      throw new ConvexError(`Cannot invite more than ${MAX_INVITEES} people`);
    }

    for (const uid of newUsers) {
      const m = await getWorkspaceMembership(ctx, event.workspaceId, uid);
      if (!m) throw new ConvexError("Invitee is not a member of this workspace");
      await ctx.db.insert("calendarEventInvitees", {
        eventId: event._id,
        workspaceId: event.workspaceId,
        userId: uid,
        status: "pending",
      });
    }

    const inviter = await ctx.db.get(userId);
    const inviterName = inviter?.name ?? inviter?.email ?? "Someone";

    for (const email of newEmails) {
      const shareId = await insertGuestShare(ctx, {
        eventId: event._id,
        workspaceId: event.workspaceId,
        createdBy: userId,
        expiresAt: event.endsAt + SHARE_BUFFER_MS,
      });
      const guestSub = generateGuestSub();
      await ctx.db.insert("calendarEventInvitees", {
        eventId: event._id,
        workspaceId: event.workspaceId,
        guestEmail: email,
        guestSub,
        status: "pending",
        shareId,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendEventInvite, {
        shareId,
        recipientEmail: email,
        inviterName,
        eventTitle: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
      });
    }

    if (newUsers.length > 0) {
      await notify(ctx, {
        category: "eventInvited",
        userId,
        userName: inviterName,
        title: "Calendar invitation",
        body: `${inviterName} invited you to ${event.title}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: newUsers,
      });
    }

    return null;
  },
});

export const removeInvitee = mutation({
  args: { inviteeId: v.id("calendarEventInvitees") },
  returns: v.null(),
  handler: async (ctx, { inviteeId }) => {
    const userId = await requireUser(ctx);
    const invitee = await ctx.db.get(inviteeId);
    if (!invitee) return null;
    const event = await ctx.db.get(invitee.eventId);
    if (!event) throw new ConvexError("Event not found");
    if (event.createdBy !== userId) {
      throw new ConvexError("Only the organizer can remove invitees");
    }

    // Revoke share if any.
    if (invitee.shareId) {
      const share = await ctx.db
        .query("resourceShares")
        .withIndex("by_shareId", (q) => q.eq("shareId", invitee.shareId!))
        .first();
      if (share && share.revokedAt === undefined) {
        await ctx.db.patch(share._id, { revokedAt: Date.now() });
      }
    }

    await ctx.db.delete(invitee._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by actions
// ---------------------------------------------------------------------------

const eventForJoinValidator = v.object({
  _id: v.id("calendarEvents"),
  workspaceId: v.id("workspaces"),
  title: v.string(),
  startsAt: v.number(),
  endsAt: v.number(),
  channelId: v.optional(v.id("channels")),
  cloudflareMeetingId: v.optional(v.string()),
  cancelledAt: v.optional(v.number()),
});

export const _getEventForJoin = internalQuery({
  args: { eventId: v.id("calendarEvents"), userId: v.id("users") },
  returns: v.union(eventForJoinValidator, v.null()),
  handler: async (ctx, { eventId, userId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    if (event.createdBy !== userId) {
      const inv = await ctx.db
        .query("calendarEventInvitees")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", eventId).eq("userId", userId),
        )
        .first();
      if (!inv) return null;
    }
    return {
      _id: event._id,
      workspaceId: event.workspaceId,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      channelId: event.channelId,
      cloudflareMeetingId: event.cloudflareMeetingId,
      cancelledAt: event.cancelledAt,
    };
  },
});

export const _getEventByShareIdForJoin = internalQuery({
  args: { shareId: v.string() },
  returns: v.union(
    v.object({
      eventId: v.id("calendarEvents"),
      workspaceId: v.id("workspaces"),
      startsAt: v.number(),
      endsAt: v.number(),
      channelId: v.optional(v.id("channels")),
      cloudflareMeetingId: v.optional(v.string()),
      cancelledAt: v.optional(v.number()),
      inviteeGuestSub: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { shareId }) => {
    const share = await ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first();
    if (!share) return null;
    if (share.resourceType !== "calendarEvent") return null;
    if (share.revokedAt !== undefined) return null;
    if (share.expiresAt !== undefined && share.expiresAt <= Date.now()) return null;

    const event = await ctx.db.get(share.resourceId as Id<"calendarEvents">);
    if (!event) return null;
    if (event.cancelledAt !== undefined) return null;

    const invitee = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_share", (q) => q.eq("shareId", shareId))
      .first();

    return {
      eventId: event._id,
      workspaceId: event.workspaceId,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      channelId: event.channelId,
      cloudflareMeetingId: event.cloudflareMeetingId,
      cancelledAt: event.cancelledAt,
      inviteeGuestSub: invitee?.guestSub,
    };
  },
});

export const _setEventMeetingId = internalMutation({
  args: {
    eventId: v.id("calendarEvents"),
    cloudflareMeetingId: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { eventId, cloudflareMeetingId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    if (event.cloudflareMeetingId) {
      // We lost the race — return the winner's ID so the caller can clean up
      // the orphan Cloudflare meeting (mirrors callSessions.createSession).
      return event.cloudflareMeetingId;
    }
    await ctx.db.patch(eventId, { cloudflareMeetingId });
    return null;
  },
});

export const _patchInviteeGuestName = internalMutation({
  args: {
    inviteeId: v.id("calendarEventInvitees"),
    guestName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { inviteeId, guestName }) => {
    await ctx.db.patch(inviteeId, { guestName });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Actions: video call join (internal members + guests)
// ---------------------------------------------------------------------------

/**
 * Race-safe wrapper for standalone events. Mirrors ensureMeetingForChannel.
 */
async function ensureMeetingForEvent(
  ctx: ActionCtx,
  eventId: Id<"calendarEvents">,
  cf: { accountId: string; appId: string; apiToken: string },
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${cf.apiToken}`,
    "Content-Type": "application/json",
  };

  // Cheap path: already provisioned.
  const existing = await ctx.runQuery(internal.calendarEvents._getEventForJoinPublic, {
    eventId,
  });
  if (existing?.cloudflareMeetingId) return existing.cloudflareMeetingId;

  const createRes = await fetch(
    `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ title: `Event call ${eventId}` }),
    },
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    console.error("Cloudflare create-meeting failed:", createRes.status, err);
    throw new Error("Could not start the call");
  }
  const createData = (await createRes.json()) as { data: { id: string } };
  const ourMeetingId = createData.data.id;

  const winner = await ctx.runMutation(internal.calendarEvents._setEventMeetingId, {
    eventId,
    cloudflareMeetingId: ourMeetingId,
  });

  if (winner && winner !== ourMeetingId) {
    void fetch(
      `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings/${ourMeetingId}`,
      { method: "DELETE", headers },
    ).catch((e) => console.error("Orphan event meeting cleanup failed:", e));
    return winner;
  }
  return ourMeetingId;
}

/**
 * Internal-query alias used by the action above. We need a no-auth lookup
 * inside the action that doesn't gate on userId — the action has already
 * authenticated the caller separately.
 */
export const _getEventForJoinPublic = internalQuery({
  args: { eventId: v.id("calendarEvents") },
  returns: v.union(
    v.object({
      cloudflareMeetingId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    return { cloudflareMeetingId: event.cloudflareMeetingId };
  },
});

export const joinEventCall = action({
  args: {
    eventId: v.id("calendarEvents"),
    userName: v.string(),
    userImage: v.optional(v.string()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
  }),
  handler: async (ctx, { eventId, userName, userImage }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const event = await ctx.runQuery(internal.calendarEvents._getEventForJoin, {
      eventId,
      userId,
    });
    if (!event) throw new ConvexError("Event not found or you are not invited");
    if (event.cancelledAt !== undefined) {
      throw new ConvexError("Event has been cancelled");
    }
    if (!isInJoinWindow(event, Date.now())) {
      throw new ConvexError("This call is not open yet");
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const appId = process.env.CLOUDFLARE_RTK_APP_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !appId || !apiToken) {
      throw new Error(
        "Missing Cloudflare RealtimeKit environment variables. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_RTK_APP_ID, and CLOUDFLARE_API_TOKEN.",
      );
    }

    const cf = { accountId, appId, apiToken };

    let meetingId: string;
    if (event.channelId) {
      // Channel-tied event: reuse the channel's persistent meeting.
      meetingId = await ensureMeetingForChannel(ctx, event.channelId, cf);
    } else {
      meetingId = await ensureMeetingForEvent(ctx, eventId, cf);
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };
    const participantRes = await fetch(
      `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: userName,
          picture: userImage,
          preset_name: "group_call_host",
          custom_participant_id: userId,
        }),
      },
    );
    if (!participantRes.ok) {
      const err = await participantRes.text();
      throw new Error(`Failed to add participant: ${err}`);
    }
    const data = (await participantRes.json()) as { data: { token: string } };
    return { authToken: data.data.token, meetingId };
  },
});

export const getGuestEventCallToken = action({
  args: {
    shareId: v.string(),
    guestName: v.string(),
    guestSub: v.string(),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
    guestSub: v.string(),
  }),
  handler: async (ctx, { shareId, guestName, guestSub }) => {
    const name = sanitizeGuestName(guestName);
    const sub = sanitizeGuestSubInput(guestSub);

    // Per-link token-bucket — same Cloudflare-quota concern as channel guests.
    await rateLimiter.limit(ctx, "guestShareCallToken", {
      key: shareId,
      throws: true,
    });

    const data = await ctx.runQuery(
      internal.calendarEvents._getEventByShareIdForJoin,
      { shareId },
    );
    if (!data) throw new ConvexError("Invitation is not active");

    const now = Date.now();
    if (
      now < data.startsAt - JOIN_WINDOW_LEAD_MS ||
      now > data.endsAt + JOIN_WINDOW_TAIL_MS
    ) {
      throw new ConvexError("This call is not open right now");
    }

    await rateLimiter.limit(ctx, "guestShareCallTokenWorkspace", {
      key: data.workspaceId,
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
    const cf = { accountId, appId, apiToken };

    let meetingId: string;
    if (data.channelId) {
      meetingId = await ensureMeetingForChannel(ctx, data.channelId, cf);
    } else {
      meetingId = await ensureMeetingForEvent(ctx, data.eventId, cf);
    }

    // Stable Cloudflare custom_participant_id: prefer the per-invitee guestSub
    // captured at invite time (so reconnects from the same share are
    // recognised as the same participant). Fall back to the client-provided
    // value for backwards compatibility.
    const fullSub = `${GUEST_SUB_PREFIX}${data.inviteeGuestSub ?? sub}`;
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };
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
      console.error(
        "Cloudflare add-participant failed:",
        participantRes.status,
        err,
      );
      throw new ConvexError("Could not join the call");
    }
    const json = (await participantRes.json()) as { data: { token: string } };
    return { authToken: json.data.token, meetingId, guestSub: sub };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers (insert + recipient collection)
// ---------------------------------------------------------------------------

async function insertGuestShare(
  ctx: { db: import("./_generated/server").MutationCtx["db"] },
  args: {
    eventId: Id<"calendarEvents">;
    workspaceId: Id<"workspaces">;
    createdBy: Id<"users">;
    expiresAt: number;
  },
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareId = generateShareId();
    const existing = await ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first();
    if (existing) continue;
    await ctx.db.insert("resourceShares", {
      shareId,
      resourceType: "calendarEvent",
      resourceId: args.eventId,
      workspaceId: args.workspaceId,
      accessLevel: "join",
      createdBy: args.createdBy,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    return shareId;
  }
  throw new ConvexError("Failed to allocate share id");
}

async function collectInternalRecipientIds(
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  eventId: Id<"calendarEvents">,
): Promise<Id<"users">[]> {
  const rows = await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  return rows
    .map((r) => r.userId)
    .filter((u): u is Id<"users"> => u !== undefined);
}

// Re-export RSVP_STATUSES so the frontend can build matching pickers.
export { RSVP_STATUSES };
