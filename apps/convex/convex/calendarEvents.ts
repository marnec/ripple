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
import { writerWithTriggers } from "convex-helpers/server/triggers";
import {
  getWorkspaceMembership,
  requireChannelAccess,
  requireUser,
  requireWorkspaceMember,
} from "./authHelpers";
import { logActivity } from "./auditLog";
import { notify } from "./utils/notify";
import { generateShareId, sanitizeGuestName } from "./utils/shareIds";
import { assertOrganizer } from "./utils/eventAuth";
import { loadInviteeRows } from "./utils/eventInvitees";
import { dispatchEventNotifications } from "./utils/eventNotifications";
import { rateLimiter } from "./rateLimits";
import { CF_API_BASE, ensureMeetingForChannel } from "./callSessions";
import { GUEST_SUB_PREFIX } from "@ripple/shared/shareTypes";
import { triggers } from "./dbTriggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import { syncTagsForResource } from "./tagSync";

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
  sequence: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
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
  event: { startsAt: number; endsAt: number },
  now: number,
): boolean {
  return (
    now >= event.startsAt - JOIN_WINDOW_LEAD_MS &&
    now <= event.endsAt + JOIN_WINDOW_TAIL_MS
  );
}

/**
 * Suppress notifications when a past event is being shuffled to another
 * past time — the organizer is cleaning up history, not changing
 * anyone's plans. Mirrored client-side (apps/web/src/lib/calendar-utils)
 * to skip the "notify invitees?" dialog at the source; this server
 * check is the safety net for non-dashboard edit paths.
 */
export function isHistoricalReschedule(
  oldStart: number,
  newStart: number,
  now: number,
): boolean {
  return oldStart < now && newStart < now;
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
/** Same shape as `eventValidator` plus a denormalized count of
 *  non-organizer invitees. Used by the dashboard calendar to decide
 *  whether a drag/resize should prompt "notify invitees?" without a
 *  follow-up roundtrip per event. */
const eventInRangeValidator = v.object({
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
  sequence: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  /** Non-organizer invitee count — drives the reschedule prompt's
   *  "X invitees" copy and gates whether the prompt fires at all. */
  nonOrganizerInviteeCount: v.number(),
});

export const listMineInRange = query({
  args: {
    workspaceId: v.id("workspaces"),
    rangeStartMs: v.number(),
    rangeEndMs: v.number(),
  },
  returns: v.array(eventInRangeValidator),
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

    // Annotate each event with its non-organizer invitee count. One
    // by_event index scan per event — cheap relative to the existing
    // `invited` lookups already performed above.
    const annotated = await Promise.all(
      events.map(async (e) => {
        const invitees = await loadInviteeRows(ctx, e._id);
        const nonOrganizerInviteeCount = invitees.filter(
          (i) => i.userId !== e.createdBy,
        ).length;
        return { ...e, nonOrganizerInviteeCount };
      }),
    );

    return annotated;
  },
});

// Background-event lane for the dashboard "view colleague calendar" filter.
// Returns timing + memberId only — no title, description, channel, or
// organizer fields cross the wire so a curious viewer can't see what their
// colleagues are actually doing, only when they're booked. The dashboard
// renders these as schedule-x background events tinted per memberId.
const memberBusyBlockValidator = v.object({
  startsAt: v.number(),
  endsAt: v.number(),
  memberId: v.id("users"),
});

export const listForMembersInRange = query({
  args: {
    workspaceId: v.id("workspaces"),
    memberIds: v.array(v.id("users")),
    rangeStartMs: v.number(),
    rangeEndMs: v.number(),
  },
  returns: v.array(memberBusyBlockValidator),
  handler: async (ctx, { workspaceId, memberIds, rangeStartMs, rangeEndMs }) => {
    const { userId: viewerId } = await requireWorkspaceMember(ctx, workspaceId);
    if (memberIds.length === 0 || rangeEndMs <= rangeStartMs) return [];

    // Block cross-workspace probing — only return blocks for memberIds that
    // are actually members of this workspace. (The viewer is already
    // authorised; the requested members are not necessarily.)
    const validMemberIds: Id<"users">[] = [];
    for (const m of memberIds) {
      // Skip the viewer themselves — their own events are already in
      // listMineInRange and we don't want to draw a busy-block on top.
      if (m === viewerId) continue;
      const membership = await getWorkspaceMembership(ctx, workspaceId, m);
      if (membership) validMemberIds.push(m);
    }

    const out: { startsAt: number; endsAt: number; memberId: Id<"users"> }[] = [];
    const seen = new Set<string>(); // dedupe by `${eventId}:${memberId}`

    // Helper: also skip events the viewer is already an invitee on, since
    // those events render in their own foreground lane via listMineInRange.
    async function viewerIsInvitee(eventId: Id<"calendarEvents">): Promise<boolean> {
      const row = await ctx.db
        .query("calendarEventInvitees")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", eventId).eq("userId", viewerId),
        )
        .first();
      return row !== null;
    }

    for (const memberId of validMemberIds) {
      // Events the member organises…
      const created = await ctx.db
        .query("calendarEvents")
        .withIndex("by_creator", (q) => q.eq("createdBy", memberId))
        .collect();
      for (const e of created) {
        if (e.workspaceId !== workspaceId) continue;
        if (e.endsAt <= rangeStartMs || e.startsAt >= rangeEndMs) continue;
        if (e.createdBy === viewerId) continue;
        if (await viewerIsInvitee(e._id)) continue;
        const k = `${e._id}:${memberId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ startsAt: e.startsAt, endsAt: e.endsAt, memberId });
      }

      // …and events the member is invited to.
      const invited = await ctx.db
        .query("calendarEventInvitees")
        .withIndex("by_user_workspace_event", (q) =>
          q.eq("userId", memberId).eq("workspaceId", workspaceId),
        )
        .collect();
      for (const row of invited) {
        const e = await ctx.db.get(row.eventId);
        if (!e) continue;
        if (e.endsAt <= rangeStartMs || e.startsAt >= rangeEndMs) continue;
        if (e.createdBy === viewerId) continue;
        if (await viewerIsInvitee(e._id)) continue;
        const k = `${e._id}:${memberId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ startsAt: e.startsAt, endsAt: e.endsAt, memberId });
      }
    }

    return out;
  },
});

export const get = query({
  args: { eventId: v.id("calendarEvents") },
  returns: eventWithInviteesValidator,
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventViewer(ctx, eventId);

    const inviteeRows = await loadInviteeRows(ctx, eventId);

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

    // The event row may already be gone (cancellation hard-deletes the
    // event and cascades the share row). In normal flow the `share`
    // lookup above returns null, so we rarely reach this branch — but
    // race conditions / stale tokens still hit here.
    const event = await ctx.db.get(share.resourceId as Id<"calendarEvents">);
    if (!event) return { status: "revoked" as const };

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

    // Insert event. Goes through writerWithTriggers so the calendarEvents
    // trigger in dbTriggers.ts creates the matching `nodes` row.
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const eventId = await db.insert("calendarEvents", {
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

    // Insert guest invitees + share rows. Email scheduling is handled
    // by dispatchEventNotifications below alongside the member fan-out.
    const guestRows: Array<{ shareId: string; guestEmail: string }> = [];
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
      guestRows.push({ shareId, guestEmail: email });
    }

    // In-app + email fan-out to all newly-added invitees. The helper
    // covers both the guest CTA (share landing) and member CTA (in-app
    // calendar) plus the email-preference filter.
    const event = (await ctx.db.get(eventId))!;
    await dispatchEventNotifications(ctx, {
      event,
      inviterId: userId,
      action: { kind: "invited", sequence: 0 },
      memberRecipientIds: userIds,
      guestRows,
    });

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
    /**
     * Whether to notify invitees about the change.
     *   • undefined (default true): preserve existing in-app notify
     *     behaviour for callers that pre-date this flag (the inline edit
     *     fields, dialogs, etc.).
     *   • true with a time change: ALSO sends a reschedule email to
     *     guests so external invitees aren't left with a stale time.
     *   • false: silent update — no in-app notification, no email. The
     *     drag/resize flow uses this when the organizer chooses
     *     "Don't send updates" in the prompt.
     */
    notifyInvitees: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found");
    assertOrganizer(event, userId, "edit this event");

    const db = writerWithTriggers(ctx, ctx.db, triggers);

    const patch: Partial<Doc<"calendarEvents">> = {};
    if (args.title !== undefined) patch.title = validateTitle(args.title);
    if (args.description !== undefined) {
      patch.description = validateDescription(args.description);
    }
    const newStart = args.startsAt ?? event.startsAt;
    const newEnd = args.endsAt ?? event.endsAt;
    const timeChanged =
      args.startsAt !== undefined || args.endsAt !== undefined;
    if (timeChanged) {
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

    await db.patch(event._id, patch);

    const shouldNotify = args.notifyInvitees ?? true;
    // Past→past time edits are organizer history-cleanup, not real
    // schedule changes. Suppress every notification channel even if
    // the caller forgot to pass `notifyInvitees: false` (e.g. event
    // detail sheet, future API consumers). The dashboard skips the
    // dialog up front via the same predicate in calendar-utils.
    const historical = timeChanged
      ? isHistoricalReschedule(event.startsAt, newStart, Date.now())
      : false;

    // In-app + email fan-out — gated on the flag and on the
    // historical-reschedule predicate. The helper handles both the
    // notify-only path (non-time edits) and the email path (time
    // changes, with guests + members sharing one bumped SEQUENCE so
    // external calendar clients update in place).
    if (shouldNotify && !historical) {
      const recipients = await collectInternalRecipientIds(ctx, event._id);
      let action: Parameters<typeof dispatchEventNotifications>[1]["action"];
      let guestRows: Array<{ guestEmail?: string }> = [];
      let updatedEvent = event;
      if (timeChanged) {
        const allInvitees = await loadInviteeRows(ctx, event._id);
        const newRangeLabel = formatRangeLabel(newStart, newEnd, event.timezone);
        const nextSequence = (event.sequence ?? 0) + 1;
        await db.patch(event._id, { sequence: nextSequence });
        updatedEvent = (await ctx.db.get(event._id))!;
        guestRows = allInvitees.filter((r) => r.guestEmail !== undefined);
        action = {
          kind: "updated-time",
          newRangeLabel,
          sequence: nextSequence,
        };
      } else {
        action = { kind: "updated-meta" };
      }
      await dispatchEventNotifications(ctx, {
        event: updatedEvent,
        inviterId: userId,
        action,
        memberRecipientIds: recipients,
        guestRows,
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

/** Replace the tag set on an event. Mirrors `documents.updateTags` /
 *  `diagrams.updateTags`: reconciles the central `tags` + `entityTags`
 *  tables, then patches the denormalized `tags` column on the event row
 *  through `writerWithTriggers` so the dbTrigger forwards the change to
 *  the polymorphic `nodes` row in one write. Auth = organizer only. */
export const updateEventTags = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, tags }) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    assertOrganizer(event, userId, "edit this event");

    const normalized = await syncTagsForResource(ctx, {
      workspaceId: event.workspaceId,
      resourceType: "calendarEvent",
      resourceId: eventId,
      nextTagNames: tags,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(eventId, { tags: normalized });
    return null;
  },
});

/** Format an event's time range as "Mon, May 4 · 10:00 AM – 11:00 AM"
 *  for the reschedule email. Uses the event's stored timezone so the
 *  recipient sees the same wall-clock times the organizer set. */
function formatRangeLabel(
  startsAt: number,
  endsAt: number,
  timezone: string,
): string {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
}

/**
 * Cancel an event. Hard-delete: we send ICS METHOD:CANCEL emails + in-app
 * notifications to every invitee, then drop the row and let cascade rules
 * (cascadeDelete.ts) clean up invitees, shares, the polymorphic node,
 * edges pointing at the event, and entityTags.
 *
 * Soft-delete (`cancelledAt`) was removed: events can only be rescheduled
 * or cancelled. There is no separate "delete" verb — calling cancel is
 * the only way to remove an event.
 *
 * Notifications fire BEFORE the cascade nukes the row, since
 * `dispatchEventNotifications` reads invitee/share state from the DB.
 * SEQUENCE is still bumped on the event row prior to dispatch so the
 * outgoing ICS attachment carries a sequence strictly greater than the
 * prior REQUEST — Outlook in particular drops cancellations whose
 * sequence isn't bumped.
 */
export const cancel = mutation({
  args: { eventId: v.id("calendarEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    assertOrganizer(event, userId, "cancel this event");

    const db = writerWithTriggers(ctx, ctx.db, triggers);

    // Snapshot invitees + bump sequence so ICS recipients accept the CANCEL.
    const invitees = await loadInviteeRows(ctx, event._id);
    const nextSequence = (event.sequence ?? 0) + 1;
    await db.patch(event._id, { sequence: nextSequence });
    const updatedEvent = (await ctx.db.get(event._id))!;

    const memberRecipientIds = invitees
      .map((r) => r.userId)
      .filter((id): id is Id<"users"> => id !== undefined);
    const guestEmailRows = invitees.filter(
      (r) => r.shareId !== undefined && r.guestEmail !== undefined,
    );
    await dispatchEventNotifications(ctx, {
      event: updatedEvent,
      inviterId: userId,
      action: { kind: "cancelled", sequence: nextSequence },
      memberRecipientIds,
      guestRows: guestEmailRows,
    });

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: event._id,
      action: "cancelled",
      resourceName: event.title,
      scope: event.workspaceId,
    });

    // Hard-delete: cascade removes invitees, shares, node, edges, entityTags.
    await cascadeDelete.deleteWithCascade(ctx, "calendarEvents", event._id, {
      onComplete: logCascadeSummary({
        userId,
        resourceType: "calendarEvents",
        resourceId: event._id,
        scope: event.workspaceId,
      }),
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
    if (!event) throw new ConvexError("Event is no longer scheduled");

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
    assertOrganizer(event, userId, "add invitees");

    // Existing invitees — used to filter duplicates.
    const existing = await loadInviteeRows(ctx, event._id);
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

    // Insert guest invitee rows + share rows. Email scheduling for
    // both the new guests and the new members goes through the
    // shared dispatch helper.
    const newGuestRows: Array<{ shareId: string; guestEmail: string }> = [];
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
      newGuestRows.push({ shareId, guestEmail: email });
    }

    // New attendees join at the event's current revision; no SEQUENCE
    // bump because existing recipients aren't affected.
    await dispatchEventNotifications(ctx, {
      event,
      inviterId: userId,
      action: { kind: "invited", sequence: event.sequence ?? 0 },
      memberRecipientIds: newUsers,
      guestRows: newGuestRows,
    });

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
    assertOrganizer(event, userId, "remove invitees");

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
    // writerWithTriggers so the calendarEvents trigger sees the patch (no-op
    // for this field — title/tags unchanged — but keeps the access pattern
    // uniform across mutations on this table).
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(eventId, { cloudflareMeetingId });
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
  const rows = await loadInviteeRows(ctx, eventId);
  return rows
    .map((r) => r.userId)
    .filter((u): u is Id<"users"> => u !== undefined);
}

// Re-export RSVP_STATUSES so the frontend can build matching pickers.
export { RSVP_STATUSES };
