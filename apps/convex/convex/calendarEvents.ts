import { v, ConvexError } from "convex/values";
import { action, internalQuery, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { affectsOnlyThePast } from "@ripple/shared/recurrence";
import {
  getWorkspaceMembership,
  requireChannelAccess,
  requireWorkspaceMember,
} from "./authHelpers";
import { logActivity } from "./auditLog";
import { emailDeliveryStatus } from "./schema";
import { notify } from "./utils/notify";
import { generateShareId, sanitizeGuestName } from "./utils/shareIds";
import { assertOrganizer } from "./utils/eventAuth";
import {
  announceOccurrenceCancelled,
  excludeOccurrenceStart,
  isSeriesInvitee,
} from "./eventSeries";
import { loadInviteeRows } from "./utils/eventInvitees";
import { dispatchEventNotifications } from "./utils/eventNotifications";
import { rateLimiter } from "./rateLimits";
import {
  ensureMeetingForChannel,
  ensureMeetingForVenue,
  findLiveMeetingForVenue,
  PRESET_NO_TRANSCRIBE,
  PRESET_TRANSCRIBE,
} from "./callSessions";
import {
  realtimeKitFromEnv,
  type RealtimeKitClient,
} from "./lib/realtimeKit";
import {
  isInJoinWindow,
  JOIN_WINDOW_LEAD_MS,
  JOIN_WINDOW_TAIL_MS,
} from "./lib/joinWindow";
import { GUEST_SUB_PREFIX } from "@ripple/shared/shareTypes";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import { syncTagsForResource } from "./tagSync";
import { normalizeEmail } from "./utils/email";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const MAX_INVITEES = 200;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
/** Upper bound on colleagues the busy-block overlay will resolve in one call. */
const MAX_OVERLAY_MEMBERS = 100;
const SHARE_BUFFER_MS = 24 * 60 * 60 * 1000; // share expires endsAt + 24h
const GUEST_SUB_MAX = 64;

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
  // Set together, and only on an **override** — a row standing in for one
  // occurrence of a series. Declared rather than stripped because a client
  // holding an override needs to know it is one: it is the coordinate that
  // leads back to the series the occurrence came from.
  seriesId: v.optional(v.id("eventSeries")),
  originalStartMs: v.optional(v.number()),
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
  // ICS REPLY idempotency keys, written by the email RSVP path
  // (calendarEventInvitees.recordEmailRsvp). Persisted on the row, so they
  // must be in the validator or `get` fails once an email RSVP lands.
  lastRsvpDtstamp: v.optional(v.number()),
  lastRsvpSequence: v.optional(v.number()),
  // Email delivery, written by the send path and the Resend webhook. Same
  // reason as the two above — persisted on the row, so `get` fails without
  // them — and the same value as on a workspace invite: a guest who is
  // `pending` because their invitation bounced looks exactly like one who
  // simply has not answered.
  deliveryEmailId: v.optional(v.string()),
  deliveryStatus: v.optional(emailDeliveryStatus),
  deliveryError: v.optional(v.string()),
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
  /** Set together, and only on an **override**. See `eventValidator`. */
  seriesId: v.optional(v.id("eventSeries")),
  originalStartMs: v.optional(v.number()),
  /** Non-organizer invitee count — drives the reschedule prompt's
   *  "X invitees" copy and gates whether the prompt fires at all. */
  nonOrganizerInviteeCount: v.number(),
});

/**
 * Every event whose time intersects `[rangeStartMs, rangeEndMs)`.
 *
 * The lower bound leans on the MAX_DURATION_MS cap that `validateTimes`
 * enforces at both write sites (create, update) — an event that ends inside
 * the window cannot have started more than MAX_DURATION_MS before it. That
 * makes this single index range the complete candidate set, which is what
 * lets both calendar queries drop their per-user and per-member history
 * scans. Widen the cap and this bound must widen with it.
 */
async function eventsTouchingWindow(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  rangeStartMs: number,
  rangeEndMs: number,
): Promise<Doc<"calendarEvents">[]> {
  const candidates = await ctx.db
    .query("calendarEvents")
    .withIndex("by_workspace_starts", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .gte("startsAt", rangeStartMs - MAX_DURATION_MS)
        .lt("startsAt", rangeEndMs),
    )
    .collect();

  return candidates.filter((e) => e.endsAt > rangeStartMs && e.startsAt < rangeEndMs);
}

/** Single indexed lookup: does this user hold an invitee row for this event? */
async function isInvitee(
  ctx: QueryCtx,
  eventId: Id<"calendarEvents">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", userId))
    .first();
  return row !== null;
}

/**
 * Does this row belong on the caller's own calendar?
 *
 * Two kinds of row, and only one of them has a roster. An ordinary event
 * carries its own invitee rows. An **override** — one occurrence of a series
 * that was moved or edited — carries none: the roster belongs to the series
 * (ADR 0002), which is why `cancel` announces an override's removal from the
 * series' roster rather than this row's. Asking an override who was coming
 * therefore finds nobody, and without this the moved Tuesday would be missing
 * from every invitee's calendar — the one week they most needed to see, since
 * it is the one that is not where the pattern says.
 *
 * Both are consulted rather than either, because an organizer can still add
 * someone to an override row directly and that row must keep working.
 */
async function isOnCallersCalendar(
  ctx: QueryCtx,
  event: Doc<"calendarEvents">,
  userId: Id<"users">,
): Promise<boolean> {
  if (
    event.seriesId !== undefined &&
    (await isSeriesInvitee(ctx, event.seriesId, userId))
  ) {
    return true;
  }
  return await isInvitee(ctx, event._id, userId);
}

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

    // One scan, and it is provably complete: `validateTimes` caps every event
    // at MAX_DURATION_MS on both write paths, so any event that touches the
    // window must start within MAX_DURATION_MS before it. There is therefore
    // no second scan of the caller's own invitee rows — that one carried no
    // event the window scan misses, and it read the caller's entire invite
    // history since signup to prove it.
    const events = (
      await eventsTouchingWindow(ctx, workspaceId, rangeStartMs, rangeEndMs)
    ).sort((a, b) => a.startsAt - b.startsAt);

    // "Mine" = organizer, or invited — to this row, or to the series an
    // override stands in for. Organizer needs no read; the rest cost one or
    // two point lookups each, bounded by the events in the window rather than
    // by the caller's tenure.
    const mine = (
      await Promise.all(
        events.map(async (e) =>
          e.createdBy === userId || (await isOnCallersCalendar(ctx, e, userId))
            ? e
            : null,
        ),
      )
    ).filter((e): e is Doc<"calendarEvents"> => e !== null);

    // The invitee rows are read only for the caller's own events, and only
    // for the count the reschedule prompt needs.
    return await Promise.all(
      mine.map(async (e) => {
        const invitees = await loadInviteeRows(ctx, e._id);
        const nonOrganizerInviteeCount = invitees.filter(
          (i) => i.userId !== e.createdBy,
        ).length;
        return { ...e, nonOrganizerInviteeCount };
      }),
    );
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
    // Each id still costs one membership read, and the overlay is a
    // hand-picked set of colleagues — nobody legitimately ticks a hundred.
    // Refuse rather than silently truncate: a short lane is indistinguishable
    // from a quiet colleague.
    if (memberIds.length > MAX_OVERLAY_MEMBERS) {
      throw new ConvexError(
        `Too many members requested (max ${MAX_OVERLAY_MEMBERS})`,
      );
    }

    // Block cross-workspace probing — only return blocks for memberIds that
    // are actually members of this workspace. (The viewer is already
    // authorised; the requested members are not necessarily.)
    const validMemberIds = new Set<Id<"users">>();
    for (const m of memberIds) {
      // Skip the viewer themselves — their own events are already in
      // listMineInRange and we don't want to draw a busy-block on top.
      if (m === viewerId) continue;
      const membership = await getWorkspaceMembership(ctx, workspaceId, m);
      if (membership) validMemberIds.add(m);
    }
    if (validMemberIds.size === 0) return [];

    // The same window scan `listMineInRange` runs, so the two queries share a
    // read set and Convex serves both from one subscription. This replaced a
    // pair of scans *per requested member*, one of which had no workspace key
    // and so read that colleague's events in every workspace they belong to.
    const events = await eventsTouchingWindow(ctx, workspaceId, rangeStartMs, rangeEndMs);

    const out: { startsAt: number; endsAt: number; memberId: Id<"users"> }[] = [];

    for (const e of events) {
      // Events the viewer already sees in their own foreground lane.
      if (e.createdBy === viewerId) continue;
      const invitees = await loadInviteeRows(ctx, e._id);
      if (invitees.some((i) => i.userId === viewerId)) continue;

      // One block per (event, member) pair: the Set collapses a member who
      // both organises the event and holds an invitee row on it.
      const participants = new Set<Id<"users">>();
      if (validMemberIds.has(e.createdBy)) participants.add(e.createdBy);
      for (const i of invitees) {
        if (i.userId && validMemberIds.has(i.userId)) participants.add(i.userId);
      }
      for (const memberId of participants) {
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
    // Workspace-scoped read (matches diagrams/tasks/projects). Any workspace
    // member can view any event; edit/cancel/RSVP/join still gated separately.
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    await requireWorkspaceMember(ctx, event.workspaceId);

    const inviteeRows = await loadInviteeRows(ctx, eventId);

    // Denormalize user fields for cheap rendering.
    //
    // `deliveryResendId` is dropped rather than declared: it is a correlation
    // key for the webhook route, of no use to a client, and handing out the
    // provider's message ids widens the surface for nothing. The delivery
    // *status* and its reason do ship — those are what the UI renders.
    const invitees = await Promise.all(
      inviteeRows.map(async ({ deliveryResendId: _resendId, ...row }) => {
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
// Mention helpers (@event in chats/docs/tasks)
// ---------------------------------------------------------------------------

/**
 * Autocomplete data source for @event mentions. Returns workspace-scoped
 * events grouped into "upcoming" (future, ascending) and "recent" (past,
 * descending) buckets.
 *
 * Empty query → browse mode: range scan on `by_workspace_starts` for the
 *   `[now − 7d, now + 30d]` window. Cheap, time-ordered.
 * Non-empty query → search mode: `by_title` full-text search filtered by
 *   workspaceId. Constant cost regardless of workspace event count.
 */
const mentionSuggestionValidator = v.object({
  eventId: v.id("calendarEvents"),
  title: v.string(),
  startsAt: v.number(),
  endsAt: v.number(),
  group: v.union(v.literal("upcoming"), v.literal("recent")),
});

const MENTION_AUTOCOMPLETE_DEFAULT_LIMIT = 8;
const MENTION_AUTOCOMPLETE_WINDOW_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MENTION_AUTOCOMPLETE_WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;

export const listForMentionAutocomplete = query({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(mentionSuggestionValidator),
  handler: async (ctx, { workspaceId, query, limit }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const now = Date.now();
    const perGroup = Math.max(1, Math.min(limit ?? MENTION_AUTOCOMPLETE_DEFAULT_LIMIT, 25));
    const trimmedQuery = (query ?? "").trim();

    let events: Doc<"calendarEvents">[];
    if (trimmedQuery.length > 0) {
      // Search mode: title FTS, workspace-filtered. Take headroom so we have
      // enough docs to split into upcoming/recent after filtering by time.
      events = await ctx.db
        .query("calendarEvents")
        .withSearchIndex("by_title", (q) =>
          q.search("title", trimmedQuery).eq("workspaceId", workspaceId),
        )
        .take(perGroup * 4);
    } else {
      // Browse mode: tight time window via the existing range index.
      events = await ctx.db
        .query("calendarEvents")
        .withIndex("by_workspace_starts", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .gte("startsAt", now - MENTION_AUTOCOMPLETE_WINDOW_PAST_MS)
            .lte("startsAt", now + MENTION_AUTOCOMPLETE_WINDOW_FUTURE_MS),
        )
        .take(perGroup * 4);
    }

    // An **override** — a row standing in for one edited occurrence of a
    // series — carries the series' own title, so leaving it in floods the
    // picker with a hundred identical "Standup" entries, none of which is the
    // thing a user means by @Standup. The series is the mention target (ADR
    // 0002); this is the explicit exclusion that costs, because the search
    // index and the browse range both cover every row in the table.
    // Regression test: `tests/occurrenceOverride.test.ts`.
    //
    // Filtered here rather than in the index range because a search index
    // cannot express "field absent", and the `take` above already reads with
    // headroom for exactly this kind of post-filtering.
    events = events.filter((e) => e.seriesId === undefined);

    const upcoming = events
      .filter((e) => e.startsAt >= now)
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, perGroup)
      .map((e) => ({
        eventId: e._id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        group: "upcoming" as const,
      }));

    const recent = events
      .filter((e) => e.startsAt < now)
      .sort((a, b) => b.startsAt - a.startsAt)
      .slice(0, perGroup)
      .map((e) => ({
        eventId: e._id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        group: "recent" as const,
      }));

    return [...upcoming, ...recent];
  },
});

/**
 * Batch-resolve event mentions referenced by a page of messages / a
 * document / a task description / a task comment. Skips cross-workspace
 * IDs (defensive — clients shouldn't be able to insert them, but the
 * BlockNote JSON is user-controlled). Missing rows surface as
 * `{ deleted: true }` so chips can render a strikethrough fallback.
 *
 * Internal-only: callers are server enrichment helpers that already
 * validated the viewer's workspace access.
 */
const mentionedEventDataValidator = v.object({
  eventId: v.id("calendarEvents"),
  title: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  deleted: v.boolean(),
});

export const getManyForMentions = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    eventIds: v.array(v.id("calendarEvents")),
  },
  returns: v.array(mentionedEventDataValidator),
  handler: async (ctx, { workspaceId, eventIds }) => {
    if (eventIds.length === 0) return [];
    // De-dupe defensively.
    const uniqueIds = Array.from(new Set(eventIds));
    const docs = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));
    return uniqueIds.map((id, i) => {
      const doc = docs[i];
      if (!doc) return { eventId: id, deleted: true };
      // Cross-workspace guard: silently treat as deleted so a stray paste
      // can't leak metadata across workspaces.
      if (doc.workspaceId !== workspaceId) return { eventId: id, deleted: true };
      return {
        eventId: id,
        title: doc.title,
        startsAt: doc.startsAt,
        endsAt: doc.endsAt,
        deleted: false,
      };
    });
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

    // The calendarEvents trigger in dbTriggers.ts creates the matching
    // `nodes` row off this insert.
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

    // Insert internal-member invitee rows. Routes through `db` (not
    // bare `ctx.db`) so the `calendarEventInvitees` trigger fires and
    // creates the matching `invites` edge in the graph.
    for (const uid of userIds) {
      await ctx.db.insert("calendarEventInvitees", {
        eventId,
        workspaceId: args.workspaceId,
        userId: uid,
        status: "pending",
      });
    }

    // Insert guest invitees + share rows. Guest rows have no `userId`
    // so the invitee trigger is a no-op for them; we still route the
    // write through `db` for consistency.
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
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "edit this event");

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

    await ctx.db.patch(event._id, patch);

    // Guest links expire against the event's end, so a reschedule has to move
    // them or every existing guest is locked out. Above the notification gate
    // on purpose — see `redateGuestShares`.
    if (timeChanged) {
      await redateGuestShares(ctx, { eventId: event._id, endsAt: newEnd });
    }

    const shouldNotify = args.notifyInvitees ?? true;
    // Past→past time edits are organizer history-cleanup, not real
    // schedule changes. Suppress every notification channel even if
    // the caller forgot to pass `notifyInvitees: false` (e.g. event
    // detail sheet, future API consumers). The dashboard skips the
    // dialog up front via the same predicate in calendar-utils.
    const historical = timeChanged
      ? affectsOnlyThePast([event.startsAt, newStart], Date.now())
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
        await ctx.db.patch(event._id, { sequence: nextSequence });
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
 *  tables, then patches the denormalized `tags` column on the event row,
 *  from which the dbTrigger forwards the change to the polymorphic `nodes`
 *  row. Auth = organizer only. */
export const updateEventTags = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, tags }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "edit this event");

    const normalized = await syncTagsForResource(ctx, {
      workspaceId: event.workspaceId,
      resourceType: "calendarEvent",
      resourceId: eventId,
      nextTagNames: tags,
    });

    await ctx.db.patch(eventId, { tags: normalized });
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
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "cancel this event");

    // An **override** stands in for one occurrence, so deleting its row is only
    // half of cancelling that occurrence: the rule would hand it straight back
    // at its original time. The other half is the excluded start, and it goes
    // first — the cap can refuse, and refusing after the cascade would be a
    // cancellation that half-happened.
    if (event.seriesId !== undefined && event.originalStartMs !== undefined) {
      const series = await ctx.db.get(event.seriesId);
      if (series) {
        await excludeOccurrenceStart(ctx, series, event.originalStartMs);
        // The roster to tell is the **series'**, not this row's: an override
        // carries no invitees of its own, so the `dispatchEventNotifications`
        // below reaches nobody and the guest's client would keep showing a
        // meeting that is off. Same announcement the series' own skip makes.
        await announceOccurrenceCancelled(ctx, {
          series,
          originalStartMs: event.originalStartMs,
          movedToMs: event.startsAt,
          actorId: userId,
          notifyInvitees: undefined,
        });
      }
    }

    // Snapshot invitees + bump sequence so ICS recipients accept the CANCEL.
    const invitees = await loadInviteeRows(ctx, event._id);
    const nextSequence = (event.sequence ?? 0) + 1;
    await ctx.db.patch(event._id, { sequence: nextSequence });
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
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the invitee row second. Nothing deletes those
    // rows on offboarding, so on their own they outlive the membership.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);

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

/**
 * Refuse a roster write aimed at an **override** — a `calendarEvents` row
 * standing in for one edited occurrence of a series (ADR 0002).
 *
 * A roster belongs to the series, never to one Tuesday of it: invite someone
 * once and they are invited to all of it. An override is not a resource — the
 * node trigger skips it, so it has no graph node — and the
 * `calendarEventInvitees` trigger would answer a roster row on one by writing
 * an `invites` edge out of a node that does not exist. Both writers into that
 * table — `addInvitees` and the organizer's `selfInvite` shortcut — go through
 * here. No product surface offers this (the series page invites through
 * `eventSeries.addInvitees`), so this is the invariant made enforceable rather
 * than merely observed.
 * Regression test: `tests/occurrenceOverride.test.ts` → "an override is not a
 * resource" → "cannot be given a roster of its own".
 */
function assertNotOverride(event: Doc<"calendarEvents">): void {
  if (event.seriesId !== undefined) {
    throw new ConvexError(
      "Invitees belong to the whole repeating event — invite them to the series, not to one occurrence",
    );
  }
}

export const addInvitees = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    userIds: v.array(v.id("users")),
    guestEmails: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "add invitees");
    assertNotOverride(event);

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

    // The `calendarEventInvitees` trigger creates the matching `invites`
    // edge in the graph for each member row inserted here.
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

    // Insert guest invitee rows + share rows. Guest rows have no
    // `userId` so the invitee trigger is a no-op for them. Email
    // scheduling for both the new guests and the new members goes
    // through the shared dispatch helper.
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

    const addedCount = newUsers.length + newEmails.length;
    if (addedCount > 0) {
      await logActivity(ctx, {
        userId, resourceType: "calendarEvents", resourceId: event._id,
        action: "invitee_added",
        newValue: String(addedCount),
        resourceName: event.title,
        scope: event.workspaceId,
      });
    }

    return null;
  },
});

/**
 * Self-invite: organiser adds themselves to the invitee list with an
 * already-accepted RSVP. Distinct from `addInvitees` so that:
 *   - no invite email / notification is dispatched (no point notifying
 *     yourself about a meeting you just decided to attend),
 *   - the row lands as "accepted" instead of "pending",
 *   - intent ("I am attending my own event") is explicit at the API
 *     boundary and trivially auditable in logs.
 *
 * Auth matches the rest of the invitee surface: must be the organiser.
 * Idempotent — silently no-ops if the organiser already has a row.
 */
export const selfInvite = mutation({
  args: { eventId: v.id("calendarEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    // This site always had the membership lookup, but ran it *after*
    // `assertOrganizer` and the invitee scan, so an ex-organizer still learned
    // the event existed and how full its guest list was.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "self-invite");
    assertNotOverride(event);

    // Idempotent: organiser already invited → no-op.
    const existing = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event_user", (q) =>
        q.eq("eventId", eventId).eq("userId", userId),
      )
      .first();
    if (existing) return null;

    // Symmetric cap with addInvitees so the organiser can't slip past
    // the limit by self-inviting after maxing out the guest list.
    const rows = await loadInviteeRows(ctx, eventId);
    if (rows.length + 1 > MAX_INVITEES) {
      throw new ConvexError(`Cannot invite more than ${MAX_INVITEES} people`);
    }

    // The `calendarEventInvitees` trigger creates the matching `invites`
    // edge for this organiser in the workspace graph. Same write path as
    // `addInvitees`.
    await ctx.db.insert("calendarEventInvitees", {
      eventId,
      workspaceId: event.workspaceId,
      userId,
      status: "accepted",
      respondedAt: Date.now(),
    });
    // No `dispatchEventNotifications` call — the whole point of
    // self-invite is that nobody (including the organiser) gets pinged.
    return null;
  },
});

export const removeInvitee = mutation({
  args: { inviteeId: v.id("calendarEventInvitees") },
  returns: v.null(),
  handler: async (ctx, { inviteeId }) => {
    const invitee = await ctx.db.get(inviteeId);
    if (!invitee) return null;
    const event = await ctx.db.get(invitee.eventId);
    if (!event) throw new ConvexError("Event not found");
    // The workspace rule first, the organizer narrowing second — in that order.
    // The gate comes off the loaded event, since the arg is an invitee row.
    const { userId, membership } = await requireWorkspaceMember(ctx, event.workspaceId);
    assertOrganizer(event, userId, membership, "remove invitees");

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

    // The `calendarEventInvitees` trigger tears down the matching
    // `invites` edge in the graph off this delete.
    await ctx.db.delete(invitee._id);

    await logActivity(ctx, {
      userId, resourceType: "calendarEvents", resourceId: event._id,
      action: "invitee_removed",
      resourceName: event.title,
      scope: event.workspaceId,
    });

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
    // The workspace rule first. Its absence here was the widest hole on the
    // event surface: `joinEventCall` hands this result to
    // `ensureMeetingForChannel`, which performs no authorization of its own, so
    // an invitee row — which offboarding does not delete — was a standing key
    // to the channel's persistent meeting room. `callSessions.joinCall` guards
    // that same room with the channel rule.
    const membership = await getWorkspaceMembership(ctx, event.workspaceId, userId);
    if (!membership) return null;
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
 * The meeting for a standalone event's call, joining one in progress or
 * starting a fresh one.
 *
 * This used to pin the meeting id to the event row forever, which made every
 * call on that event the *same* Cloudflare meeting — one meeting, one session
 * by meeting id, and so the second call's transcript was discarded as a
 * duplicate of the first call's. Worse, there was no session row at all, so
 * there was never a first transcript either.
 *
 * A standalone event is now a call **venue** like a channel is: successive
 * calls are successive session rows, each with its own meeting and its own
 * transcript, and all the liveness reasoning (`active` is a claim, Cloudflare
 * is the fact, retire by id) is the shared one rather than a second copy.
 */
async function ensureMeetingForEvent(
  ctx: ActionCtx,
  eventId: Id<"calendarEvents">,
  rtk: RealtimeKitClient,
): Promise<string> {
  const { meetingId } = await ensureMeetingForVenue(
    ctx,
    { kind: "event", eventId },
    rtk,
    false,
  );
  return meetingId;
}

/**
 * The live meeting for a standalone event's call, or null — never starting
 * one. The guest form, for exactly the reason `findLiveMeetingForChannel`
 * exists: a guest on a share link must not be able to mint a call in a
 * workspace they are not a member of.
 */
async function findLiveMeetingForEvent(
  ctx: ActionCtx,
  eventId: Id<"calendarEvents">,
  rtk: RealtimeKitClient,
): Promise<string | null> {
  const live = await findLiveMeetingForVenue(ctx, { kind: "event", eventId }, rtk);
  return live?.meetingId ?? null;
}

export const joinEventCall = action({
  args: {
    eventId: v.id("calendarEvents"),
    userName: v.string(),
    userImage: v.optional(v.string()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
    // The call's effective transcription mode, mirroring `callSessions.joinCall`.
    transcribe: v.boolean(),
    // The channel whose meeting this event call is using, when the event is
    // tied to one. A channel-tied event call *is* that channel's call — same
    // Cloudflare meeting — so reporting it lets the client publish the same
    // presence signal a direct channel join does, which is what the sidebar
    // indicator and the joiner's lobby both read. Null for a standalone event,
    // which has a room of its own that presence does not track.
    channelId: v.union(v.id("channels"), v.null()),
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

    const rtk = realtimeKitFromEnv();

    let meetingId: string;
    let transcribe: boolean;
    if (event.channelId) {
      // Channel-tied event: reuse the channel's persistent meeting. Event
      // calls have no transcription toggle of their own, so this never starts
      // a transcribed call — but it may *join* one the channel already has,
      // and the mode that comes back is the meeting's, not this `false`.
      ({ meetingId, transcribe } = await ensureMeetingForChannel(
        ctx,
        event.channelId,
        rtk,
        false,
      ));
    } else {
      meetingId = await ensureMeetingForEvent(ctx, eventId, rtk);
      // `ensureMeetingForEvent` never sets `transcribeOnEnd`.
      transcribe = false;
    }

    // The preset must follow the meeting's mode. This used to hardcode
    // `group_call_host` — the transcribe-enabled preset — so an event joiner
    // landing in a channel's non-transcribing call arrived flagged for
    // transcription anyway. Selected the same way `callSessions.joinCall`
    // does, from the value the meeting actually reported.
    const { token: authToken } = await rtk.addParticipant(meetingId, {
      name: userName,
      picture: userImage,
      presetName: transcribe ? PRESET_TRANSCRIBE : PRESET_NO_TRANSCRIBE,
      customParticipantId: userId,
    });
    return { authToken, meetingId, transcribe, channelId: event.channelId ?? null };
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
    // See the note on `shares.getGuestCallToken`. A channel-tied event shares
    // the channel's meeting and so inherits its mode; a standalone event's
    // meeting is created without `transcribeOnEnd` and is always false.
    transcribe: v.boolean(),
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

    const rtk = realtimeKitFromEnv();

    let meetingId: string;
    let transcribe: boolean;
    if (data.channelId) {
      ({ meetingId, transcribe } = await ensureMeetingForChannel(
        ctx,
        data.channelId,
        rtk,
        false,
      ));
    } else {
      // A guest may join a standalone event's call but never start one, the
      // same rule `shares.getGuestCallToken` applies to a channel's.
      const live = await findLiveMeetingForEvent(ctx, data.eventId, rtk);
      if (!live) throw new ConvexError("This call has not started yet");
      meetingId = live;
      transcribe = false;
    }

    // Stable Cloudflare custom_participant_id: prefer the per-invitee guestSub
    // captured at invite time (so reconnects from the same share are
    // recognised as the same participant). Fall back to the client-provided
    // value for backwards compatibility.
    const fullSub = `${GUEST_SUB_PREFIX}${data.inviteeGuestSub ?? sub}`;
    let authToken: string;
    try {
      ({ token: authToken } = await rtk.addParticipant(meetingId, {
        name,
        presetName: "group_call_participant",
        customParticipantId: fullSub,
      }));
    } catch (e) {
      console.error("Cloudflare add-participant failed:", e);
      throw new ConvexError("Could not join the call");
    }
    return { authToken, meetingId, guestSub: sub, transcribe };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers (insert + recipient collection)
// ---------------------------------------------------------------------------

/**
 * Re-date an event's guest share links after its time moved.
 *
 * A guest share is stamped `endsAt + SHARE_BUFFER_MS` when it is issued and
 * was never touched again, so a reschedule left every existing guest holding a
 * link that expires against the OLD end. What made this quiet is that the parts
 * a guest sees first kept working: the corrected ICS still arrived and email
 * RSVP still resolved. Only `/share/<id>`, `respondAsGuest` and
 * `getGuestEventCallToken` failed — that is, the guest could not join the call
 * they had just been re-invited to, with no way to tell why. `addInvitees`
 * cannot reissue (it filters emails that already hold a row), so the only
 * recovery was for the organizer to remove and re-add the guest.
 *
 * Runs on every time change, deliberately NOT gated on `notifyInvitees` or on
 * the historical-reschedule predicate. Those two decide whether to *tell*
 * anyone; a silent reschedule that leaves the links dead is precisely the case
 * the guest cannot diagnose. Moving an event earlier shortens the window for
 * the same reason it lengthens it on a later move — the link tracks the event.
 *
 * Scoped to shares an invitee row points at. A link created by hand through
 * `shares.createShare` carries an operator-chosen expiry — possibly none at
 * all — which is not ours to overwrite.
 */
async function redateGuestShares(
  ctx: { db: import("./_generated/server").MutationCtx["db"] },
  args: { eventId: Id<"calendarEvents">; endsAt: number },
): Promise<void> {
  const rows = await loadInviteeRows(ctx, args.eventId);
  const nextExpiresAt = args.endsAt + SHARE_BUFFER_MS;
  for (const row of rows) {
    const shareId = row.shareId;
    if (shareId === undefined) continue;
    const share = await ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first();
    if (!share) continue;
    // A revoked link stays revoked — the organizer took it away on purpose.
    if (share.revokedAt !== undefined) continue;
    if (share.expiresAt === nextExpiresAt) continue;
    await ctx.db.patch(share._id, { expiresAt: nextExpiresAt });
  }
}

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
