import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isPublicChannel } from "@ripple/shared/channel";
import {
  RecurrenceLimitError,
  affectsOnlyThePast,
  expandSeries,
  lastOccurrenceEndsAt,
  nextOccurrenceFrom,
  reachOfEdit,
  seriesEndsAt,
  splitSeries,
  validateSeries,
  type SeriesDefinition,
  type Weekday,
} from "@ripple/shared/recurrence";

import {
  action,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getWorkspaceMembership,
  requireChannelAccess,
  requireWorkspaceMember,
} from "./authHelpers";
import { logActivity } from "./auditLog";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import {
  ensureMeetingForChannel,
  ensureMeetingForVenue,
  PRESET_NO_TRANSCRIBE,
  PRESET_TRANSCRIBE,
} from "./callSessions";
import { realtimeKitFromEnv } from "./lib/realtimeKit";
import {
  occurrenceOpenAt,
  toSeriesDefinition,
} from "./lib/seriesOccurrence";
import { syncTagsForResource } from "./tagSync";
import { assertOrganizer } from "./utils/eventAuth";
import { notify } from "./utils/notify";
import { sendSeriesIcsMail } from "./utils/seriesGuestMail";
import { generateShareId, sanitizeGuestName } from "./utils/shareIds";
import { normalizeEmail } from "./utils/email";

/**
 * A series that names no end still needs a value in `activeUntil`, because
 * that column is what lets the range read drop series that have finished. The
 * sentinel is the largest instant a `Date` can hold, so an open-ended series
 * is never dropped and the horizon does the bounding at read time instead.
 */
export const SERIES_NO_END = 8_640_000_000_000_000;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5_000;
/** The same 24-hour cap a one-off event carries, for the same reason. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_OVERLAY_MEMBERS = 20;
/** The same roster cap a one-off event carries, for the same reason. */
const MAX_INVITEES = 200;

function validateTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0) throw new ConvexError("Title is required");
  if (title.length > TITLE_MAX) {
    throw new ConvexError(`Title must be ${TITLE_MAX} characters or fewer`);
  }
  return title;
}

function validateDescription(raw: string | undefined): string | undefined {
  if (raw !== undefined && raw.length > DESCRIPTION_MAX) {
    throw new ConvexError(
      `Description must be ${DESCRIPTION_MAX} characters or fewer`,
    );
  }
  return raw;
}

const ruleValidator = v.object({
  freq: v.union(
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("monthly"),
    v.literal("yearly"),
  ),
  interval: v.number(),
  weekdays: v.optional(v.array(v.string())),
  monthlyMode: v.optional(
    v.union(v.literal("dayOfMonth"), v.literal("nthWeekday")),
  ),
  end: v.union(
    v.object({ kind: v.literal("never") }),
    v.object({ kind: v.literal("onDate"), date: v.string() }),
    v.object({ kind: v.literal("afterCount"), count: v.number() }),
  ),
});

/**
 * The stored row as the recurrence module wants it. Lives in
 * `lib/seriesOccurrence` so that `callSessions` — which must resolve the
 * occurrence a call happened in — can reach it without the two files importing
 * each other; re-exported here because this is where callers look for it.
 */
export { toSeriesDefinition };

/**
 * The original starts this series has overrides for, among the occurrences a
 * window could produce. Feeding them back into the expansion is what keeps a
 * moved Tuesday from showing twice: its own row is carried by the events scan
 * at wherever it was moved to, so the rule must stop claiming it.
 *
 * The range mirrors the expansion's own: an occurrence touching the window
 * cannot start more than one duration before it.
 */
async function overriddenStarts(
  ctx: QueryCtx,
  series: Doc<"eventSeries">,
  windowStartMs: number,
  windowEndMs: number,
): Promise<number[]> {
  // Bounded by the occurrences one window can hold — the same 366 the
  // expansion refuses past — because there is at most one override per
  // original start. Taking a page instead would under-suppress and show the
  // moved Tuesday twice, which is worse than a read that is already capped.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const overrides = await ctx.db
    .query("calendarEvents")
    .withIndex("by_series_original_start", (q) =>
      q
        .eq("seriesId", series._id)
        .gte("originalStartMs", windowStartMs - series.durationMs)
        .lt("originalStartMs", windowEndMs),
    )
    .collect();
  return overrides
    .map((o) => o.originalStartMs)
    .filter((ms): ms is number => ms !== undefined);
}

/**
 * Turn a recurrence limit into something the user can read. The module throws
 * these mid-read, where returning a short list instead would be indis-
 * tinguishable from a quiet calendar.
 */
function rethrowAsConvexError(e: unknown): never {
  if (e instanceof RecurrenceLimitError) throw new ConvexError(e.message);
  throw e;
}

/**
 * Every live series in the workspace: those with anything left after
 * `fromMs`. This read set is the workspace's series, not its history — see
 * ADR 0002 for why that is acceptable and what would make it stop being so.
 */
async function liveSeries(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  fromMs: number,
): Promise<Doc<"eventSeries">[]> {
  // The whole live-series set, deliberately — ADR 0002 accepts this read set
  // because series count grows with meetings-that-repeat rather than with user
  // activity, and `activeUntil` drops the ones that have finished. If that
  // stops being true the fix is a narrower index range, not pagination: a
  // half-expanded calendar is indistinguishable from a quiet one.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  return await ctx.db
    .query("eventSeries")
    .withIndex("by_workspace_activeUntil", (q) =>
      q.eq("workspaceId", workspaceId).gt("activeUntil", fromMs),
    )
    .collect();
}

/**
 * Every roster row for a series. The rows are series-level — there is exactly
 * one per person however many occurrences the rule produces.
 */
async function loadSeriesInviteeRows(
  ctx: { db: QueryCtx["db"] },
  seriesId: Id<"eventSeries">,
): Promise<Doc<"eventSeriesInvitees">[]> {
  // Bounded by MAX_INVITEES at every write path, the same bound and the same
  // reasoning as the one-off event's roster read.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  return await ctx.db
    .query("eventSeriesInvitees")
    .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
    .collect();
}

/**
 * The **bare** in-app link to a series — no original-start coordinate. A bare
 * link resolves to the next occurrence from now (falling back to the last one
 * once the series has ended), which is what a notification about the series
 * itself should open; only a notification about one occurrence carries the
 * coordinate.
 */
function seriesUrl(series: Doc<"eventSeries">): string {
  return `/workspaces/${series.workspaceId}/events/${series._id}`;
}

/** Exported for `calendarEvents.listMineInRange`, which has to ask the same
 *  question about an **override**: that row carries no invitees of its own,
 *  so whether it belongs on someone's calendar is the series' roster to
 *  answer. */
export async function isSeriesInvitee(
  ctx: QueryCtx,
  seriesId: Id<"eventSeries">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("eventSeriesInvitees")
    .withIndex("by_series_user", (q) =>
      q.eq("seriesId", seriesId).eq("userId", userId),
    )
    .first();
  return row !== null;
}

const rsvpStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("tentative"),
);

const seriesInviteeValidator = v.object({
  _id: v.id("eventSeriesInvitees"),
  _creationTime: v.number(),
  seriesId: v.id("eventSeries"),
  workspaceId: v.id("workspaces"),
  /**
   * Unset on every row this release writes, and it means "the series". The
   * field is here from day one so that per-occurrence decline is later a UI
   * and index change rather than a migration of every roster.
   */
  originalStartMs: v.optional(v.number()),
  userId: v.optional(v.id("users")),
  guestEmail: v.optional(v.string()),
  guestName: v.optional(v.string()),
  guestSub: v.optional(v.string()),
  status: rsvpStatusValidator,
  respondedAt: v.optional(v.number()),
  shareId: v.optional(v.string()),
  // Replay guards for inbound ICS replies — carried here only because the row
  // is returned whole; nothing in the UI reads them.
  lastRsvpDtstamp: v.optional(v.number()),
  lastRsvpSequence: v.optional(v.number()),
  // Denormalized for cheap rendering, as on the one-off event's roster.
  userName: v.optional(v.string()),
  userImage: v.optional(v.string()),
  userEmail: v.optional(v.string()),
});

const occurrenceValidator = v.object({
  seriesId: v.id("eventSeries"),
  /** The occurrence's name, forever — it does not move and it survives cancellation. */
  originalStartMs: v.number(),
  startsAt: v.number(),
  endsAt: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  timezone: v.string(),
  channelId: v.optional(v.id("channels")),
  createdBy: v.id("users"),
  tags: v.optional(v.array(v.string())),
  /**
   * How many people other than the organizer are on the **series'** roster.
   *
   * Counted once per series and stamped on every occurrence it produces: the
   * roster belongs to the ritual, so every Tuesday carries the same number,
   * and the drag-and-drop prompt can say "2 invitees, this occurrence" without
   * a second round trip. Zero means there is nobody to ask about.
   */
  nonOrganizerInviteeCount: v.number(),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Occurrences of the caller's series that touch `[rangeStartMs, rangeEndMs)`.
 *
 * Deliberately a *second* query beside `calendarEvents.listMineInRange` rather
 * than a widening of it: that one's completeness rests on the 24-hour duration
 * cap, and it keeps carrying one-off events and overrides untouched. The client
 * subscribes to both and concatenates.
 */
export const listMineInRange = query({
  args: {
    workspaceId: v.id("workspaces"),
    rangeStartMs: v.number(),
    rangeEndMs: v.number(),
  },
  returns: v.array(occurrenceValidator),
  handler: async (ctx, { workspaceId, rangeStartMs, rangeEndMs }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);
    if (rangeEndMs <= rangeStartMs) return [];

    // "Mine" = I organize it, or I am on its roster. The roster row points at
    // the **series**, so being invited once puts every occurrence here — the
    // point of the whole feature, and the reason there is no per-occurrence
    // read. The organizer needs no lookup; the rest cost one `by_series_user`
    // point read each, bounded by the workspace's live series.
    const candidates = await liveSeries(ctx, workspaceId, rangeStartMs);
    const series = (
      await Promise.all(
        candidates.map(async (s) =>
          s.createdBy === userId || (await isSeriesInvitee(ctx, s._id, userId))
            ? s
            : null,
        ),
      )
    ).filter((s): s is Doc<"eventSeries"> => s !== null);

    const out: Array<typeof occurrenceValidator.type> = [];
    for (const s of series) {
      // One roster read per series, not per occurrence: everyone invited to
      // the standup is invited to all of it.
      const nonOrganizerInviteeCount = (
        await loadSeriesInviteeRows(ctx, s._id)
      ).filter((row) => row.userId !== s.createdBy).length;
      const definition = toSeriesDefinition(s);
      definition.overriddenStarts = await overriddenStarts(
        ctx,
        s,
        rangeStartMs,
        rangeEndMs,
      );
      let occurrences;
      try {
        occurrences = expandSeries(definition, {
          windowStartMs: rangeStartMs,
          windowEndMs: rangeEndMs,
        });
      } catch (e) {
        rethrowAsConvexError(e);
      }
      for (const o of occurrences) {
        out.push({
          seriesId: s._id,
          originalStartMs: o.originalStartMs,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
          title: s.title,
          description: s.description,
          timezone: s.timezone,
          channelId: s.channelId,
          createdBy: s.createdBy,
          tags: s.tags,
          nonOrganizerInviteeCount,
        });
      }
    }
    return out.sort((a, b) => a.startsAt - b.startsAt);
  },
});

/**
 * The busy-block lane for the colleague-availability overlay: when a member is
 * booked by a series, never what by. Same shape and same discretion as
 * `calendarEvents.listForMembersInRange`.
 */
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
    if (memberIds.length > MAX_OVERLAY_MEMBERS) {
      throw new ConvexError(
        `Too many members requested (max ${MAX_OVERLAY_MEMBERS})`,
      );
    }

    // Only members of this workspace, so the overlay cannot be used to probe
    // for someone's bookings elsewhere.
    const valid = new Set<Id<"users">>();
    for (const m of memberIds) {
      if (m === viewerId) continue;
      if (await getWorkspaceMembership(ctx, workspaceId, m)) valid.add(m);
    }
    if (valid.size === 0) return [];

    const out: Array<{ startsAt: number; endsAt: number; memberId: Id<"users"> }> = [];
    for (const s of await liveSeries(ctx, workspaceId, rangeStartMs)) {
      // The viewer's own series are already in their foreground lane.
      if (s.createdBy === viewerId) continue;
      if (!valid.has(s.createdBy)) continue;

      // A moved occurrence is busy at its new time, and the events lane in
      // `calendarEvents.listForMembersInRange` already carries it there — so
      // the rule must stop claiming it here, exactly as in the lane above.
      const definition = toSeriesDefinition(s);
      definition.overriddenStarts = await overriddenStarts(
        ctx,
        s,
        rangeStartMs,
        rangeEndMs,
      );
      let occurrences;
      try {
        occurrences = expandSeries(definition, {
          windowStartMs: rangeStartMs,
          windowEndMs: rangeEndMs,
        });
      } catch (e) {
        rethrowAsConvexError(e);
      }
      for (const o of occurrences) {
        out.push({ startsAt: o.startsAt, endsAt: o.endsAt, memberId: s.createdBy });
      }
    }
    return out;
  },
});

const seriesValidator = v.object({
  _id: v.id("eventSeries"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  title: v.string(),
  description: v.optional(v.string()),
  anchorDate: v.string(),
  anchorTime: v.string(),
  durationMs: v.number(),
  timezone: v.string(),
  rule: ruleValidator,
  excludedStarts: v.optional(v.array(v.number())),
  channelId: v.optional(v.id("channels")),
  cloudflareMeetingId: v.optional(v.string()),
  createdBy: v.id("users"),
  sequence: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  activeUntil: v.number(),
});

export const get = query({
  args: { seriesId: v.id("eventSeries") },
  returns: v.union(seriesValidator, v.null()),
  handler: async (ctx, { seriesId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const series = await ctx.db.get(seriesId);
    if (!series) return null;
    // The workspace rule: every member of the workspace reaches it.
    const membership = await getWorkspaceMembership(
      ctx,
      series.workspaceId,
      userId,
    );
    if (!membership) return null;
    return series;
  },
});

/**
 * Where a **bare** `/events/<id>` link should land.
 *
 * An occurrence's URL carries the series and an original start; a link to the
 * *series* carries only the id, because a notification about the pattern has
 * no one date to name. So the id has to be resolved before the page can know
 * what it is looking at, and it comes in as a string rather than as
 * `v.id("eventSeries")` for exactly that reason: the same route also serves
 * one-off events, and validating the arg as a series id would reject every
 * event link before the handler ever ran.
 *
 * `null` means "not a series of yours" — an event id, an unknown id, or a
 * series in a workspace the caller is not in. All three land the page on its
 * ordinary event path, which is also the honest answer for the last of them:
 * a non-member learns nothing about what the id is.
 *
 * A **null `originalStartMs`** is the one series with nowhere to land: every
 * occurrence cancelled. It still names the series, because sending that link
 * down the events path would produce exactly the dead page the fallback exists
 * to prevent.
 */
export const resolveLink = query({
  args: { linkId: v.string() },
  returns: v.union(
    v.object({
      seriesId: v.id("eventSeries"),
      originalStartMs: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { linkId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const seriesId = ctx.db.normalizeId("eventSeries", linkId);
    if (!seriesId) return null;
    const series = await ctx.db.get(seriesId);
    if (!series) return null;
    // The workspace rule, as everywhere else a series is read.
    const membership = await getWorkspaceMembership(
      ctx,
      series.workspaceId,
      userId,
    );
    if (!membership) return null;

    const occurrence = nextOccurrenceFrom(toSeriesDefinition(series), Date.now());
    return { seriesId, originalStartMs: occurrence?.originalStartMs ?? null };
  },
});

/**
 * Autocomplete data source for `@`-mentioning a **series**.
 *
 * A second query beside `calendarEvents.listForMentionAutocomplete` rather
 * than a widening of it, because the two lanes have nothing in common at the
 * index level: an event is found by its `startsAt`, and a series has none —
 * its occurrences are computed. The picker concatenates them, exactly as the
 * calendar does with the two range reads.
 *
 * One entry per series, which is the whole point of user story 37: mentioning
 * the standup means the ritual, not one Tuesday of it, and the picker is not
 * flooded with a hundred identically-named entries. Overrides never appear
 * here at all — they live in the events table, and the events lane already
 * excludes them (ADR 0002).
 */
const seriesMentionSuggestionValidator = v.object({
  seriesId: v.id("eventSeries"),
  title: v.string(),
  /**
   * When the series next meets — the last occurrence once it has ended, and
   * null for a series whose every occurrence has been cancelled. The picker
   * shows it as the subtext, which is the only thing that tells two rituals
   * with the same name apart.
   */
  nextStartsAt: v.union(v.number(), v.null()),
});

const SERIES_MENTION_DEFAULT_LIMIT = 8;

export const listForMentionAutocomplete = query({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(seriesMentionSuggestionValidator),
  handler: async (ctx, { workspaceId, query: searchText, limit }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const take = Math.max(1, Math.min(limit ?? SERIES_MENTION_DEFAULT_LIMIT, 25));
    const trimmed = (searchText ?? "").trim();

    const rows =
      trimmed.length > 0
        ? await ctx.db
            .query("eventSeries")
            .withSearchIndex("by_title", (q) =>
              q.search("title", trimmed).eq("workspaceId", workspaceId),
            )
            .take(take)
        : // Browse mode: the workspace's *live* series, newest first. A series
          // that has finished is not something anyone means by `@Standup`, and
          // `activeUntil` is the column that already knows.
          await ctx.db
            .query("eventSeries")
            .withIndex("by_workspace_activeUntil", (q) =>
              q.eq("workspaceId", workspaceId).gt("activeUntil", Date.now()),
            )
            .order("desc")
            .take(take);

    const now = Date.now();
    return rows
      .map((series) => ({
        seriesId: series._id,
        title: series.title,
        nextStartsAt:
          nextOccurrenceFrom(toSeriesDefinition(series), now)?.startsAt ?? null,
      }))
      .sort((a, b) => (a.nextStartsAt ?? Infinity) - (b.nextStartsAt ?? Infinity));
  },
});

/**
 * The series' roster: one row per person, whatever the rule produces.
 *
 * Workspace-scoped, matching `eventSeries.get` and `calendarEvents.get` — any
 * member of the workspace can see who is coming; adding, removing and
 * answering are gated separately.
 */
export const listInvitees = query({
  args: { seriesId: v.id("eventSeries") },
  returns: v.array(seriesInviteeValidator),
  handler: async (ctx, { seriesId }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    await requireWorkspaceMember(ctx, series.workspaceId);

    const rows = await loadSeriesInviteeRows(ctx, seriesId);
    return await Promise.all(
      rows.map(async (row) => {
        if (!row.userId) return { ...row };
        const user = await ctx.db.get(row.userId);
        return {
          ...row,
          userName: user?.name ?? undefined,
          userEmail: user?.email ?? undefined,
          userImage: user?.image ?? undefined,
        };
      }),
    );
  },
});

/**
 * Public (no-auth) landing read for a guest's series link.
 *
 * Hands back the **rule**, not a list of dates: the recurrence module is
 * shared and browser-safe, so the guest's page expands the pattern itself and
 * this query stays free of the per-window occurrence cap and of any opinion
 * about which occurrence is "the" one. Never returns the roster — a guest
 * learns what the meeting is, never who else was invited.
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
    series: v.optional(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        anchorDate: v.string(),
        anchorTime: v.string(),
        durationMs: v.number(),
        timezone: v.string(),
        rule: ruleValidator,
        excludedStarts: v.optional(v.array(v.number())),
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
    if (share.resourceType !== "eventSeries") {
      return { status: "not_found" as const };
    }
    if (share.revokedAt !== undefined) return { status: "revoked" as const };
    if (share.expiresAt !== undefined && share.expiresAt <= Date.now()) {
      return { status: "expired" as const };
    }

    // Deleting the series cascades the share row away, so this is the race
    // rather than the normal path — but a stale token must still land on the
    // ordinary not-available treatment rather than an error.
    const series = await ctx.db.get(share.resourceId as Id<"eventSeries">);
    if (!series) return { status: "revoked" as const };

    const organizer = await ctx.db.get(series.createdBy);
    const workspace = await ctx.db.get(series.workspaceId);
    const inviteeRow = await ctx.db
      .query("eventSeriesInvitees")
      .withIndex("by_share", (q) => q.eq("shareId", shareId))
      .first();

    return {
      status: "active" as const,
      series: {
        title: series.title,
        description: series.description,
        anchorDate: series.anchorDate,
        anchorTime: series.anchorTime,
        durationMs: series.durationMs,
        timezone: series.timezone,
        rule: series.rule,
        excludedStarts: series.excludedStarts,
        organizerName: organizer?.name ?? undefined,
        workspaceName: workspace?.name ?? undefined,
      },
      invitee: inviteeRow
        ? { status: inviteeRow.status, guestName: inviteeRow.guestName }
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
    anchorDate: v.string(),
    anchorTime: v.string(),
    durationMs: v.number(),
    timezone: v.string(),
    rule: ruleValidator,
    channelId: v.optional(v.id("channels")),
    /**
     * The roster the organizer picked in the create form, carried in rather
     * than followed up with a second call: the series and the invitations it
     * went out with are one transaction, so an organizer who pressed Create
     * never ends up with a series their team was never told about. Optional
     * because every other caller — and a repeat created with nobody on it —
     * has nothing to say here.
     */
    invitees: v.optional(
      v.object({
        userIds: v.array(v.id("users")),
        guestEmails: v.array(v.string()),
      }),
    ),
  },
  returns: v.id("eventSeries"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);

    if (args.channelId) {
      const access = await requireChannelAccess(ctx, args.channelId);
      if (access.channel.workspaceId !== args.workspaceId) {
        throw new ConvexError("Channel is not in this workspace");
      }
    }

    const title = validateTitle(args.title);
    validateDescription(args.description);
    if (!Number.isFinite(args.durationMs) || args.durationMs <= 0) {
      throw new ConvexError("Event end must be after start");
    }
    if (args.durationMs > MAX_DURATION_MS) {
      throw new ConvexError("Event duration cannot exceed 24 hours");
    }

    const definition: SeriesDefinition = {
      anchor: {
        date: args.anchorDate,
        time: args.anchorTime,
        timezone: args.timezone,
        durationMs: args.durationMs,
      },
      rule: {
        freq: args.rule.freq,
        interval: args.rule.interval,
        weekdays: args.rule.weekdays as Weekday[] | undefined,
        monthlyMode: args.rule.monthlyMode,
        end: args.rule.end,
      },
    };

    const verdict = validateSeries(definition);
    if (!verdict.ok) throw new ConvexError(verdict.message);

    const seriesId = await ctx.db.insert("eventSeries", {
      workspaceId: args.workspaceId,
      title,
      description: args.description,
      anchorDate: args.anchorDate,
      anchorTime: args.anchorTime,
      durationMs: args.durationMs,
      timezone: args.timezone,
      rule: args.rule,
      channelId: args.channelId,
      createdBy: userId,
      activeUntil: lastOccurrenceEndsAt(definition) ?? SERIES_NO_END,
    });

    if (args.invitees) {
      // The creator is the organizer, so the narrowing `addInvitees` performs
      // is already satisfied — what is left is the roster itself.
      const series = (await ctx.db.get(seriesId))!;
      await inviteToSeries(ctx, series, userId, args.invitees);
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: seriesId,
      action: "created",
      resourceName: title,
      scope: args.workspaceId,
    });

    return seriesId;
  },
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * The channel rule for a named user, rather than for the caller's own
 * identity: the join path resolves its user id in the action and hands it
 * down, so `checkChannelAccess` — which reads the identity off `ctx` — is not
 * the shape this needs.
 */
async function mayEnterChannel(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
): Promise<boolean> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return false;
  if (isPublicChannel(channel)) return true;
  const membership = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", channelId).eq("userId", userId),
    )
    .first();
  return membership !== null;
}

/**
 * What the join action needs, and the answer to "is a call open right now".
 *
 * The occurrence is resolved from the clock rather than taken from the caller:
 * the join link an organizer shares once carries no occurrence coordinate —
 * that is what lets it keep working for the life of the series — so the only
 * honest answer to "which occurrence is this" is the one whose join window is
 * open.
 */
export const _getSeriesForJoin = internalQuery({
  args: { seriesId: v.id("eventSeries"), userId: v.id("users") },
  returns: v.union(
    v.object({
      workspaceId: v.id("workspaces"),
      channelId: v.union(v.id("channels"), v.null()),
      occurrenceOpen: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { seriesId, userId }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) return null;

    // The workspace rule, the same one `get` applies. A series has no roster
    // of its own yet; when the invitee rows arrive they narrow this the way
    // an invitee row narrows `calendarEvents._getEventForJoin`.
    const membership = await getWorkspaceMembership(
      ctx,
      series.workspaceId,
      userId,
    );
    if (!membership) return null;

    // A series hosted in a channel meets in that channel's room, so reaching
    // it takes the channel rule — workspace membership alone does not open a
    // closed channel's call.
    if (series.channelId && !(await mayEnterChannel(ctx, series.channelId, userId))) {
      return null;
    }

    return {
      workspaceId: series.workspaceId,
      channelId: series.channelId ?? null,
      occurrenceOpen: occurrenceOpenAt(series, Date.now()) !== null,
    };
  },
});

/**
 * Join the call for whichever occurrence of `seriesId` is happening now,
 * starting one if nobody has yet.
 *
 * One room for the life of the series — the venue is the series, exactly as a
 * channel is a venue — and one session per call, so each occurrence's call
 * gets its own Cloudflare meeting and therefore its own transcript document.
 */
export const joinSeriesCall = action({
  args: {
    seriesId: v.id("eventSeries"),
    userName: v.string(),
    userImage: v.optional(v.string()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
    transcribe: v.boolean(),
    // The channel whose meeting this call is using, when the series is hosted
    // in one — the client publishes the same presence signal a direct channel
    // join does. Null for a standalone series, which has a room of its own.
    channelId: v.union(v.id("channels"), v.null()),
  }),
  handler: async (ctx, { seriesId, userName, userImage }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Authorize BEFORE touching Cloudflare: the join path creates the meeting
    // when none is live, so an unauthorized caller must not get that far.
    const series = await ctx.runQuery(internal.eventSeries._getSeriesForJoin, {
      seriesId,
      userId,
    });
    if (!series) throw new ConvexError("Event not found or you are not invited");
    if (!series.occurrenceOpen) {
      throw new ConvexError("This call is not open yet");
    }

    const rtk = realtimeKitFromEnv();

    const { meetingId, transcribe } = series.channelId
      ? // A channel-hosted series borrows that channel's persistent room, as a
        // channel-tied event does. Series calls have no transcription toggle of
        // their own, so this never *starts* a transcribed call — but it may
        // join one the channel already has, and the mode that comes back is
        // the meeting's rather than this `false`.
        await ensureMeetingForChannel(ctx, series.channelId, rtk, false)
      : await ensureMeetingForVenue(ctx, { kind: "series", seriesId }, rtk, false);

    const { token: authToken } = await rtk.addParticipant(meetingId, {
      name: userName,
      picture: userImage,
      presetName: transcribe ? PRESET_TRANSCRIBE : PRESET_NO_TRANSCRIBE,
      customParticipantId: userId,
    });

    return { authToken, meetingId, transcribe, channelId: series.channelId };
  },
});

/**
 * The organizer narrowing, applied on top of the workspace rule and never
 * instead of it — the same shape, and the same reasoning, as `assertOrganizer`
 * for a one-off event. `membership` is unused at runtime and required anyway,
 * so a membership-less call cannot be written: an organizer who has left the
 * workspace must not keep the power to rewrite what they left behind. A series
 * has no admin escape hatch either — nobody else rewrites someone's ritual.
 */
function assertSeriesOrganizer(
  series: Doc<"eventSeries">,
  userId: Id<"users">,
  membership: Doc<"workspaceMembers">,
  verb: string,
): void {
  if (series.createdBy !== userId) {
    throw new ConvexError(`Only the organizer can ${verb}`);
  }
}

/** The override filed under this coordinate, or null when there is none. */
async function findOverride(
  ctx: QueryCtx,
  seriesId: Id<"eventSeries">,
  originalStartMs: number,
): Promise<Doc<"calendarEvents"> | null> {
  return await ctx.db
    .query("calendarEvents")
    .withIndex("by_series_original_start", (q) =>
      q.eq("seriesId", seriesId).eq("originalStartMs", originalStartMs),
    )
    .unique();
}

// ---------------------------------------------------------------------------
// Telling the roster
//
// A repeating meeting makes the one-off event's "notify invitees?" question
// bigger in one way only: the edit may reach one occurrence, or the rest of
// them, or all of them. So the answer needs a scope, and the suppression rule
// generalises with it — "this reschedule is past→past" becomes "every
// occurrence this edit touches has already happened".
//
// The predicate itself is `affectsOnlyThePast` in the shared recurrence
// module, and the occurrences it weighs come from `reachOfEdit` in the same
// place. Both are what the organizer's prompt calls before deciding whether to
// ask; running them again here is the safety net for every other door into
// these mutations, exactly as `calendarEvents.update` re-runs the one-off
// version (spec 0003, "Email and ICS").
// ---------------------------------------------------------------------------

/**
 * What an edit applied to, in the terms the notification decision needs.
 *
 * `occurrence` carries its own instants because a single occurrence's reach is
 * not something the rule can answer: an override may have been moved away from
 * where the rule puts it, and the edit may be moving it again. Old start and
 * new start, exactly as a one-off event's reschedule reports them.
 */
type SeriesNotifyScope =
  | { kind: "occurrence"; originalStartMs: number; instants: number[] }
  | { kind: "following"; fromOriginalStartMs: number }
  | { kind: "series" };

/**
 * Tell the series' roster that something changed.
 *
 * Silent in three cases, which are one case: the organizer said not to, nobody
 * but them is on the roster, or the edit changes nobody's plans because every
 * occurrence it reaches is already behind us.
 *
 * Members only — a guest's message about a series is one ICS entry carrying
 * the whole pattern, which is its own lane.
 */
async function notifySeriesChange(
  ctx: MutationCtx,
  args: {
    /** The series as the handler loaded it, i.e. before its own write. */
    series: Doc<"eventSeries">;
    actorId: Id<"users">;
    /** The organizer's answer. Absent means yes, as on a one-off event. */
    notifyInvitees: boolean | undefined;
    scope: SeriesNotifyScope;
    action: "updated" | "cancelled";
  },
  // Whether the change is being announced at all — the organizer said yes (or
  // was never asked) and something it touches is still ahead. Both lanes turn
  // on this one answer: the in-app fan-out here, and the guest ICS mail at the
  // call site. Declining the prompt, or tidying up last quarter's standups,
  // therefore sends nothing by *either* route rather than only by one.
): Promise<boolean> {
  const { series, actorId, scope, action } = args;
  if (args.notifyInvitees === false) return false;

  const nowMs = Date.now();
  const instants =
    scope.kind === "occurrence"
      ? scope.instants
      : reachOfEdit(
          toSeriesDefinition(series),
          nowMs,
          scope.kind === "following" ? scope.fromOriginalStartMs : undefined,
        ).instants;
  if (affectsOnlyThePast(instants, nowMs)) return false;

  const recipientIds = (await loadSeriesInviteeRows(ctx, series._id))
    .map((row) => row.userId)
    .filter((id): id is Id<"users"> => id !== undefined && id !== actorId);
  // No *members* to tell is not the same as nothing to announce: a series
  // whose roster is all external guests still has mail to send.
  if (recipientIds.length === 0) return true;

  const actor = await ctx.db.get(actorId);
  const actorName = actor?.name ?? actor?.email ?? "Someone";

  const cancelled = action === "cancelled";
  const body = cancelled
    ? scope.kind === "occurrence"
      ? `${actorName} cancelled one occurrence of ${series.title}`
      : `${actorName} cancelled ${series.title}`
    : `${actorName} updated ${series.title}`;
  // A notification about one occurrence carries the coordinate so it opens
  // that date; one about the pattern goes bare and lands on whichever
  // occurrence is next. A cancelled *series* has no page left to open.
  const url =
    cancelled && scope.kind === "series"
      ? `/workspaces/${series.workspaceId}/dashboard/calendar`
      : scope.kind === "occurrence"
        ? `${seriesUrl(series)}?on=${scope.originalStartMs}`
        : seriesUrl(series);

  await notify(ctx, {
    category: cancelled ? "eventCancelled" : "eventUpdated",
    userId: actorId,
    userName: actorName,
    title: cancelled ? "Calendar event cancelled" : "Calendar event updated",
    body,
    url,
    recipientIds,
  });
  return true;
}

/**
 * Record that this occurrence is not happening.
 *
 * Exported because there are two doors to the same decision. An unmoved
 * occurrence is skipped through `cancelOccurrence`; a *moved* one is an
 * ordinary-looking event row by then, so the button in front of the organizer
 * is the event surface's own "Cancel event" — and deleting that row alone would
 * hand the occurrence straight back to the rule at its original time.
 */
export async function excludeOccurrenceStart(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  originalStartMs: number,
): Promise<void> {
  const excludedStarts = [
    ...new Set([...(series.excludedStarts ?? []), originalStartMs]),
  ].sort((a, b) => a - b);

  // The cap belongs to the recurrence module, message and all — asking it
  // rather than re-deriving the number here is what keeps the refusal a
  // refusal instead of a silently-dropped skip. A series that was valid before
  // an exclusion can only fail on this one count.
  const verdict = validateSeries({
    ...toSeriesDefinition(series),
    excludedStarts,
  });
  if (!verdict.ok) throw new ConvexError(verdict.message);

  await ctx.db.patch(series._id, { excludedStarts });
}

/**
 * Skip one occurrence.
 *
 * A cancelled occurrence costs no row of any kind — it is an entry in the
 * series' excluded starts, which is also exactly what an ICS `EXDATE` is. If
 * the occurrence had already been moved, its override goes with it: the
 * organizer cancelled that Tuesday, not the version of it the rule describes.
 */
/**
 * Tell the roster that one occurrence is off.
 *
 * Both routes to skipping a Tuesday end here: the series' own
 * `cancelOccurrence`, and `calendarEvents.cancel` when the row it is deleting
 * turns out to be an **override**. That second route is not a corner — editing
 * an occurrence mints an override and the product navigates straight to its
 * event page, so the ordinary "cancel" in front of the organizer is a skip.
 *
 * It has to live in one place because the two lanes disagree about where a
 * roster is: `calendarEvents.cancel` notifies from the *event's* invitee rows,
 * and an override has none — the roster belongs to the series. Announcing from
 * there sent nobody anything, so the occurrence left the calendar while the
 * guest's client kept showing it.
 *
 * `movedToMs` is where the occurrence actually was: a moved one is cancelled at
 * the time it was moved to, not at the time the rule names it by.
 */
export async function announceOccurrenceCancelled(
  ctx: MutationCtx,
  args: {
    series: Doc<"eventSeries">;
    originalStartMs: number;
    movedToMs: number;
    actorId: Id<"users">;
    notifyInvitees: boolean | undefined;
  },
): Promise<void> {
  const announced = await notifySeriesChange(ctx, {
    series: args.series,
    actorId: args.actorId,
    notifyInvitees: args.notifyInvitees,
    scope: {
      kind: "occurrence",
      originalStartMs: args.originalStartMs,
      instants: [args.movedToMs],
    },
    action: "cancelled",
  });

  // The skip reaches a guest's client as one more EXDATE on the pattern they
  // already hold, which is what makes the occurrence disappear from it.
  if (announced) {
    await sendSeriesIcsMail(ctx, {
      seriesId: args.series._id,
      actorId: args.actorId,
      kind: "updated",
    });
  }
}

export const cancelOccurrence = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    originalStartMs: v.number(),
    notifyInvitees: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { seriesId, originalStartMs, notifyInvitees }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "cancel this occurrence");

    await excludeOccurrenceStart(ctx, series, originalStartMs);

    const override = await findOverride(ctx, seriesId, originalStartMs);
    if (override) await ctx.db.delete(override._id);

    await announceOccurrenceCancelled(ctx, {
      series,
      originalStartMs,
      movedToMs: override?.startsAt ?? originalStartMs,
      actorId: userId,
      notifyInvitees,
    });
    return null;
  },
});

/**
 * Cancel the whole series — the one action behind "delete this series".
 *
 * A hard delete, exactly as `calendarEvents.cancel` is: the row goes and the
 * cascade rules (`cascadeDelete.ts`) take the overrides, the roster, the guest
 * shares, the call sessions, the graph node, the edges pointing at it, and the
 * tag join rows. There is no soft-cancelled series, because a series that is
 * still a row is still a row every range query has to read and every occurrence
 * has to be filtered out of.
 *
 * **Past occurrences go with it.** Nothing of record is lost by that: a call's
 * transcript is a `documents` row of its own, and the trail of who did what is
 * in the audit log — both already outlive an event (spec 0003, "Deletion").
 * The cascade removes the *session* row, which is the only thing holding a
 * pointer at the transcript, so the document survives with no link left behind
 * rather than one pointing at a series that is gone.
 */
export const cancel = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    notifyInvitees: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { seriesId, notifyInvitees }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    // The workspace rule first, the organizer narrowing second — in that order,
    // as everywhere else on this resource.
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "cancel this series");

    // Before the cascade, which takes the roster rows this reads.
    const announced = await notifySeriesChange(ctx, {
      series,
      actorId: userId,
      notifyInvitees,
      scope: { kind: "series" },
      action: "cancelled",
    });

    // One CANCEL under the pattern's own UID, which is what withdraws it from
    // a guest's client.
    if (announced) {
      await sendSeriesIcsMail(ctx, {
        seriesId: series._id,
        actorId: userId,
        kind: "cancelled",
      });
    }

    await logActivity(ctx, {
      userId,
      // The audit log's resource vocabulary is the one-off event's; a series is
      // the same kind of thing to a reader of the workspace timeline, and the
      // id distinguishes them.
      resourceType: "calendarEvents",
      resourceId: series._id,
      action: "cancelled",
      resourceName: series.title,
      scope: series.workspaceId,
    });

    await cascadeDelete.deleteWithCascade(ctx, "eventSeries", series._id, {
      onComplete: logCascadeSummary({
        userId,
        resourceType: "eventSeries",
        resourceId: series._id,
        scope: series.workspaceId,
      }),
    });

    return null;
  },
});

/**
 * Edit one occurrence, and only that one.
 *
 * The row this writes is an **override**: a `calendarEvents` row filed under
 * the occurrence's original start, which from then on carries that Tuesday and
 * stops tracking the series. It is deliberately a full row rather than a patch
 * — a later series-wide *content* edit does not propagate into it (ADR 0002).
 *
 * An override is emphatically *not* a resource: it gets no graph node and no
 * mention-autocomplete entry. Both exclusions are explicit conditions written
 * elsewhere (`dbTriggers.ts`, `listForMentionAutocomplete`), because both
 * mechanisms act on every row in that table by default.
 */
export const updateOccurrence = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    originalStartMs: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    notifyInvitees: v.optional(v.boolean()),
  },
  returns: v.id("calendarEvents"),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "edit this occurrence");

    const existing = await findOverride(ctx, args.seriesId, args.originalStartMs);
    // What the occurrence is *now*: its own row where one exists, and what the
    // rule would place otherwise.
    const startsAt = args.startsAt ?? existing?.startsAt ?? args.originalStartMs;
    const endsAt =
      args.endsAt ??
      existing?.endsAt ??
      args.originalStartMs + series.durationMs;
    if (endsAt <= startsAt) throw new ConvexError("Event end must be after start");
    if (endsAt - startsAt > MAX_DURATION_MS) {
      throw new ConvexError("Event duration cannot exceed 24 hours");
    }

    const title =
      args.title !== undefined
        ? validateTitle(args.title)
        : (existing?.title ?? series.title);
    const description =
      args.description !== undefined
        ? validateDescription(args.description)
        : (existing?.description ?? series.description);

    // Where the occurrence was before this edit: its own row's time where it
    // had one, and where the rule puts it otherwise.
    const previousStart = existing?.startsAt ?? args.originalStartMs;
    let overrideId: Id<"calendarEvents">;
    if (existing) {
      await ctx.db.patch(existing._id, { title, description, startsAt, endsAt });
      overrideId = existing._id;
    } else {
      overrideId = await ctx.db.insert("calendarEvents", {
        workspaceId: series.workspaceId,
        title,
        description,
        startsAt,
        endsAt,
        timezone: series.timezone,
        channelId: series.channelId,
        createdBy: series.createdBy,
        seriesId: series._id,
        originalStartMs: args.originalStartMs,
        // `sequence` deliberately unset: there is one counter for the whole
        // pattern and it lives on the series (spec 0003, "Email and ICS").
      });
    }

    const announced = await notifySeriesChange(ctx, {
      series,
      actorId: userId,
      notifyInvitees: args.notifyInvitees,
      scope: {
        kind: "occurrence",
        originalStartMs: args.originalStartMs,
        instants: [previousStart, startsAt],
      },
      action: "updated",
    });

    // The roster gets the pattern restated, this occurrence now carried as its
    // own RECURRENCE-ID entry, so a moved Tuesday shows at its new time rather
    // than leaving someone in an empty room.
    if (announced) {
      await sendSeriesIcsMail(ctx, {
        seriesId: series._id,
        actorId: userId,
        kind: "updated",
      });
    }
    return overrideId;
  },
});

/**
 * Rename the series — the ritual, not one Tuesday of it.
 *
 * A **content** edit over the whole series, which is why it needs no scope
 * question: there is one title, and the occurrences that show anything else are
 * the overrides, which a content edit deliberately leaves standing (ADR 0002).
 * The `nodes` row, the mention target and the guest page all read the series,
 * so this one patch is the whole rename — the `eventSeries` node trigger
 * carries it into the graph.
 */
export const rename = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { seriesId, title }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "rename this series");

    const next = validateTitle(title);
    await ctx.db.patch(seriesId, { title: next });

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: seriesId,
      action: "updated",
      resourceName: next,
      scope: series.workspaceId,
    });
    return null;
  },
});

/**
 * Replace the tag set on a series. Mirrors `calendarEvents.updateEventTags`:
 * reconciles the central `tags` + `entityTags` tables, then patches the
 * denormalized column on the series row.
 *
 * The tags belong to the **series** and to nothing else. An occurrence has no
 * row to tag, and tagging fifty-two Tuesdays "planning" is exactly the flood
 * that makes a workspace's tag lists stop meaning anything (spec, user story
 * 22).
 */
export const updateTags = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { seriesId, tags }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "edit this series");

    const normalized = await syncTagsForResource(ctx, {
      workspaceId: series.workspaceId,
      resourceType: "eventSeries",
      resourceId: seriesId,
      nextTagNames: tags,
    });

    await ctx.db.patch(seriesId, { tags: normalized });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The wider edit scopes
//
// An edit to a repeating meeting has to answer a question a one-off edit never
// asks: what does it apply to? The three answers are three mutations —
// `updateOccurrence` above (this occurrence), `updateFollowing` (this and
// following) and `updateSeries` (all occurrences) — because they are three
// genuinely different writes, not one write with a mode flag. The scope is
// chosen in a dialog **on save**; nothing here knows or cares about that.
// ---------------------------------------------------------------------------

/**
 * The parts of a series an edit may carry, minus the anchor date: the split
 * point supplies that for `updateFollowing`, and `updateSeries` takes it
 * separately.
 */
const seriesEditArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  anchorTime: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  timezone: v.optional(v.string()),
  rule: v.optional(ruleValidator),
  channelId: v.optional(v.id("channels")),
};

/** The rule as the recurrence module wants it, from validator-shaped input. */
function toRule(rule: Doc<"eventSeries">["rule"]) {
  return {
    freq: rule.freq,
    interval: rule.interval,
    weekdays: rule.weekdays as Weekday[] | undefined,
    monthlyMode: rule.monthlyMode,
    end: rule.end,
  };
}

/** Everything an edit may carry, as the two `updateFollowing`/`updateSeries` args agree on it. */
type SeriesEdit = {
  title?: string;
  description?: string;
  anchorDate?: string;
  anchorTime?: string;
  durationMs?: number;
  timezone?: string;
  rule?: Doc<"eventSeries">["rule"];
  channelId?: Id<"channels">;
};

/**
 * Write the edit onto the series itself — the "all occurrences" write, also
 * reached by a split whose chosen occurrence is the first one.
 *
 * `activeUntil` is recomputed unconditionally rather than only on a rule
 * change: it is the denormalized "nothing after this instant" the range read
 * drops finished series by, so leaving it stale after a shortened rule leaves
 * occurrences on calendars that the rule no longer produces.
 */
async function applySeriesEdit(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  edit: SeriesEdit,
): Promise<void> {
  const anchor = {
    date: edit.anchorDate ?? series.anchorDate,
    time: edit.anchorTime ?? series.anchorTime,
    timezone: edit.timezone ?? series.timezone,
    durationMs: edit.durationMs ?? series.durationMs,
  };
  if (anchor.durationMs <= 0 || !Number.isFinite(anchor.durationMs)) {
    throw new ConvexError("Event end must be after start");
  }
  if (anchor.durationMs > MAX_DURATION_MS) {
    throw new ConvexError("Event duration cannot exceed 24 hours");
  }
  if (edit.channelId) {
    const access = await requireChannelAccess(ctx, edit.channelId);
    if (access.channel.workspaceId !== series.workspaceId) {
      throw new ConvexError("Channel is not in this workspace");
    }
  }

  const rule = edit.rule ?? series.rule;
  const definition = {
    anchor,
    rule: toRule(rule),
    excludedStarts: series.excludedStarts,
  };
  const verdict = validateSeries(definition);
  if (!verdict.ok) throw new ConvexError(verdict.message);

  await ctx.db.patch(series._id, {
    title: edit.title !== undefined ? validateTitle(edit.title) : series.title,
    description:
      edit.description !== undefined
        ? validateDescription(edit.description)
        : series.description,
    anchorDate: anchor.date,
    anchorTime: anchor.time,
    durationMs: anchor.durationMs,
    timezone: anchor.timezone,
    rule,
    channelId: edit.channelId ?? series.channelId,
    activeUntil: lastOccurrenceEndsAt(definition) ?? SERIES_NO_END,
  });
}

/**
 * Every override this series carries, optionally only those filed at or after
 * `fromOriginalStartMs`.
 *
 * Bounded by how many occurrences an organizer has actually customised by
 * hand, which is the same bound the range read's override suppression already
 * lives with. A page would be worse than a big read here: half a re-filing is
 * a series showing some Tuesdays twice.
 */
async function overridesFrom(
  ctx: MutationCtx,
  seriesId: Id<"eventSeries">,
  fromOriginalStartMs?: number,
): Promise<Doc<"calendarEvents">[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  return await ctx.db
    .query("calendarEvents")
    .withIndex("by_series_original_start", (q) =>
      fromOriginalStartMs === undefined
        ? q.eq("seriesId", seriesId)
        : q.eq("seriesId", seriesId).gte("originalStartMs", fromOriginalStartMs),
    )
    .collect();
}

/**
 * Copy a series' roster onto the continuation of a split.
 *
 * Everyone invited to the standup is still invited to the standup — the split
 * is an implementation of "from next month we meet at 09:30", not a
 * re-invitation — so each row's RSVP carries over rather than reverting to
 * pending. What does *not* carry over is a guest's share id: a share row
 * points at exactly one resource, and the continuation is a different one, so
 * every guest is issued the continuation's own link.
 */
async function copyRosterTo(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  continuationId: Id<"eventSeries">,
  actorId: Id<"users">,
): Promise<void> {
  const rows = await loadSeriesInviteeRows(ctx, series._id);
  const continuation = await ctx.db.get(continuationId);
  const expiresAt = continuation
    ? guestShareExpiryFor(continuation, Date.now())
    : Date.now();

  for (const row of rows) {
    const shareId = row.guestEmail
      ? await insertSeriesGuestShare(ctx, {
          seriesId: continuationId,
          workspaceId: series.workspaceId,
          createdBy: actorId,
          expiresAt,
        })
      : undefined;
    await ctx.db.insert("eventSeriesInvitees", {
      seriesId: continuationId,
      workspaceId: series.workspaceId,
      userId: row.userId,
      guestEmail: row.guestEmail,
      guestName: row.guestName,
      guestSub: row.guestSub,
      status: row.status,
      respondedAt: row.respondedAt,
      shareId,
    });
  }
}

/**
 * "This and following": a **split**.
 *
 * The original series is truncated to end before the chosen occurrence, and a
 * second series is created carrying the change, the roster and the rest of the
 * rule. The continuation is a genuinely separate resource with its own id — it
 * is not a variant of the first, which is why this returns a new series id and
 * why the roster is copied rather than shared.
 *
 * Splitting at the very first occurrence has nothing to truncate: the organizer
 * is really editing the whole series, so that is what happens, in place, and
 * the same id comes back.
 */
export const updateFollowing = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    originalStartMs: v.number(),
    notifyInvitees: v.optional(v.boolean()),
    ...seriesEditArgs,
  },
  returns: v.id("eventSeries"),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "edit this series");

    // Ahead of the write, because the decision is about the series as it
    // stands and both paths below end in a `return`. Nothing escapes early: a
    // refused edit rolls the queued notification back with everything else.
    const announced = await notifySeriesChange(ctx, {
      series,
      actorId: userId,
      notifyInvitees: args.notifyInvitees,
      // A split at the very first occurrence reaches the whole series, which
      // is what "from the first occurrence onward" already says.
      scope: { kind: "following", fromOriginalStartMs: args.originalStartMs },
      action: "updated",
    });

    const split = splitSeries(toSeriesDefinition(series), args.originalStartMs);

    // Nothing precedes the split, so there is no second resource worth
    // making — the organizer is really editing the whole series, and a rule
    // edit resets what it moves here exactly as it does under "all".
    if (split.truncated === null) {
      if (isRuleEdit(series, args)) {
        for (const override of await overridesFrom(ctx, series._id)) {
          await ctx.db.delete(override._id);
        }
      }
      await applySeriesEdit(ctx, series, args);
      if (announced) {
        await sendSeriesIcsMail(ctx, {
          seriesId: series._id,
          actorId: userId,
          kind: "updated",
        });
      }
      return series._id;
    }

    await ctx.db.patch(series._id, {
      rule: { ...series.rule, end: split.truncated.rule.end },
      excludedStarts: split.truncated.excludedStarts,
      activeUntil: lastOccurrenceEndsAt(split.truncated) ?? SERIES_NO_END,
    });

    const continuationDefinition = {
      anchor: {
        ...split.continuation.anchor,
        time: args.anchorTime ?? split.continuation.anchor.time,
        timezone: args.timezone ?? split.continuation.anchor.timezone,
        durationMs: args.durationMs ?? split.continuation.anchor.durationMs,
      },
      rule: args.rule ? toRule(args.rule) : split.continuation.rule,
      excludedStarts: split.continuation.excludedStarts,
    };
    const verdict = validateSeries(continuationDefinition);
    if (!verdict.ok) throw new ConvexError(verdict.message);

    const continuationId = await ctx.db.insert("eventSeries", {
      workspaceId: series.workspaceId,
      title: args.title !== undefined ? validateTitle(args.title) : series.title,
      description:
        args.description !== undefined
          ? validateDescription(args.description)
          : series.description,
      anchorDate: continuationDefinition.anchor.date,
      anchorTime: continuationDefinition.anchor.time,
      durationMs: continuationDefinition.anchor.durationMs,
      timezone: continuationDefinition.anchor.timezone,
      rule: args.rule ?? { ...series.rule, end: split.continuation.rule.end },
      excludedStarts: split.continuation.excludedStarts,
      channelId: args.channelId ?? series.channelId,
      createdBy: series.createdBy,
      tags: series.tags,
      activeUntil: lastOccurrenceEndsAt(continuationDefinition) ?? SERIES_NO_END,
    });

    await copyRosterTo(ctx, series, continuationId, userId);

    // Overrides from the split point onward are the continuation's business
    // now, and what happens to them is the same distinction "all occurrences"
    // draws. A content edit re-files them, keeping the organizer's
    // customisations and keeping the continuation from producing a Tuesday an
    // override is already carrying. A rule edit resets them, because the
    // original starts they are filed under are not where the new rule puts
    // anything — re-filing those would show that week twice, once from the
    // rule and once from the orphan.
    const movesOccurrences = isRuleEdit(series, args);
    for (const override of await overridesFrom(
      ctx,
      series._id,
      args.originalStartMs,
    )) {
      if (movesOccurrences) await ctx.db.delete(override._id);
      else await ctx.db.patch(override._id, { seriesId: continuationId });
    }

    // The truncated original goes out as an **update** under the UID the
    // roster already holds, and the continuation as a **fresh invitation**
    // under its own. No CANCEL is sent for the original: cancelling makes a
    // client delete the occurrences that already happened, which is history
    // the organizer never asked to lose (spec 0003, ADR 0002).
    if (announced) {
      await sendSeriesIcsMail(ctx, {
        seriesId: series._id,
        actorId: userId,
        kind: "updated",
        continuationId,
      });
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: continuationId,
      action: "created",
      resourceName: args.title ?? series.title,
      scope: series.workspaceId,
    });

    return continuationId;
  },
});

/**
 * Whether an edit moves the occurrences the rule produces, rather than
 * changing what they say.
 *
 * The distinction is the whole of the "all occurrences" behaviour: a rule edit
 * resets every override, a content edit leaves them all standing. It is
 * decided by comparing against what is stored, so re-saving an unchanged
 * recurrence is a content edit and costs nobody their customisations.
 */
function isRuleEdit(series: Doc<"eventSeries">, edit: SeriesEdit): boolean {
  const changed = <T>(next: T | undefined, current: T) =>
    next !== undefined && next !== current;
  return (
    changed(edit.anchorDate, series.anchorDate) ||
    changed(edit.anchorTime, series.anchorTime) ||
    changed(edit.durationMs, series.durationMs) ||
    changed(edit.timezone, series.timezone) ||
    (edit.rule !== undefined && !sameRule(edit.rule, series.rule))
  );
}

/**
 * Field-by-field, rather than by serializing both sides: a form hands back
 * every field it holds whether or not the organizer touched it, so "the same
 * rule again" has to compare equal or every save would look like a rule edit
 * and cost somebody their customised occurrences.
 */
function sameRule(
  a: Doc<"eventSeries">["rule"],
  b: Doc<"eventSeries">["rule"],
): boolean {
  const sameEnd =
    a.end.kind === b.end.kind &&
    (a.end.kind !== "onDate" || a.end.date === (b.end as typeof a.end).date) &&
    (a.end.kind !== "afterCount" ||
      a.end.count === (b.end as typeof a.end).count);
  const days = (r: Doc<"eventSeries">["rule"]) => (r.weekdays ?? []).join(",");
  return (
    a.freq === b.freq &&
    a.interval === b.interval &&
    a.monthlyMode === b.monthlyMode &&
    days(a) === days(b) &&
    sameEnd
  );
}

/**
 * How many occurrences of this series have been customised by hand — the
 * number a "this will reset them" confirmation has to state before the
 * organizer commits to a rule edit.
 *
 * `fromOriginalStartMs` narrows it to a split's blast radius: "this and
 * following" only ever resets what lies at or after the chosen occurrence.
 */
export const countOverrides = query({
  args: {
    seriesId: v.id("eventSeries"),
    fromOriginalStartMs: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, { seriesId, fromOriginalStartMs }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    await requireWorkspaceMember(ctx, series.workspaceId);
    // Bounded by how many occurrences an organizer has customised by hand, the
    // same bound the range read's override suppression already lives with.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const overrides = await ctx.db
      .query("calendarEvents")
      .withIndex("by_series_original_start", (q) =>
        fromOriginalStartMs === undefined
          ? q.eq("seriesId", seriesId)
          : q
              .eq("seriesId", seriesId)
              .gte("originalStartMs", fromOriginalStartMs),
      )
      .collect();
    return overrides.length;
  },
});

/**
 * "All occurrences": the edit applies to the whole series.
 *
 * Which divides in two, and the difference is visible to the organizer.
 *
 * A **content edit** — title, description, venue — leaves every override
 * standing and does not propagate into any of them, so a renamed series can
 * leave one occurrence showing its old name. That is the accepted, documented
 * behaviour (ADR 0002): an override is a full row that stopped tracking the
 * series, not a patch layered over it.
 *
 * A **rule edit** — recurrence, anchor or duration — resets every override,
 * because the original starts they are filed under may no longer exist. The
 * confirmation that states how many will go is the caller's, and the count it
 * needs comes from `countOverrides`.
 */
export const updateSeries = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    anchorDate: v.optional(v.string()),
    notifyInvitees: v.optional(v.boolean()),
    ...seriesEditArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) throw new ConvexError("Series not found");
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertSeriesOrganizer(series, userId, membership, "edit this series");

    const announced = await notifySeriesChange(ctx, {
      series,
      actorId: userId,
      notifyInvitees: args.notifyInvitees,
      scope: { kind: "series" },
      action: "updated",
    });

    if (isRuleEdit(series, args)) {
      for (const override of await overridesFrom(ctx, series._id)) {
        await ctx.db.delete(override._id);
      }
    }

    await applySeriesEdit(ctx, series, args);

    // One update for the whole pattern, under the UID the roster already
    // holds, so every client applies it in place instead of filing a duplicate.
    if (announced) {
      await sendSeriesIcsMail(ctx, {
        seriesId: series._id,
        actorId: userId,
        kind: "updated",
      });
    }

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: series._id,
      action: "updated",
      resourceName: args.title ?? series.title,
      scope: series.workspaceId,
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Guest share links
//
// **How long a guest's link lives.** For a series with an end, until a day
// after its last occurrence — the same rule a one-off event's link follows,
// read off the last occurrence rather than off `endsAt`. For an open-ended
// one there is no last occurrence to read, so the link runs out to the
// horizon and is pushed forward again every time the guest actually uses it.
//
// That combination is the whole point: someone who keeps attending an
// indefinite commitment never needs a new link, and a link nobody has touched
// for two years still ages out instead of standing open forever.
// ---------------------------------------------------------------------------

/** A day past the last occurrence, exactly as a one-off event's link gets. */
const SHARE_BUFFER_MS = 24 * 60 * 60 * 1000;

function guestShareExpiryFor(series: Doc<"eventSeries">, nowMs: number): number {
  const definition = toSeriesDefinition(series);
  // A bounded rule answers to its own last occurrence, **unclamped**. The
  // horizon bounds how far a *read* may expand; it is not a statement about
  // when the series stops, and using it here would lock a guest out of a
  // four-year commitment in its third year. `seriesEndsAt` clamps for exactly
  // the read-side reason, so it is only right for the other case.
  const last = lastOccurrenceEndsAt(definition);
  // No end named: there is no last occurrence to answer to, so the link runs
  // to the horizon past `nowMs` — which is what makes it roll forward on use
  // rather than being fixed at issue time.
  return (last ?? seriesEndsAt(definition, nowMs)) + SHARE_BUFFER_MS;
}

async function insertSeriesGuestShare(
  ctx: { db: MutationCtx["db"] },
  args: {
    seriesId: Id<"eventSeries">;
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
      resourceType: "eventSeries",
      resourceId: args.seriesId,
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

/**
 * Push a guest's link forward because they just used it.
 *
 * Only ever extends. A bounded series' expiry is a fixed instant — a day past
 * its last occurrence — so recomputing it from `now` yields the same answer
 * and this is a no-op; an open-ended series' expiry is a rolling horizon, so
 * each use buys another two years. It never shortens: the caller here is a
 * guest, and a guest arriving at their own link must not be able to bring its
 * death forward.
 *
 * Extension happens on *use*, deliberately, and not on a schedule. That is
 * what lets an abandoned link age out while an indefinite commitment never
 * needs a new one.
 */
async function extendGuestShareOnUse(
  ctx: { db: MutationCtx["db"] },
  share: Doc<"resourceShares">,
  series: Doc<"eventSeries">,
  nowMs: number,
): Promise<void> {
  if (share.revokedAt !== undefined) return;
  const next = guestShareExpiryFor(series, nowMs);
  if (share.expiresAt !== undefined && share.expiresAt >= next) return;
  await ctx.db.patch(share._id, { expiresAt: next, lastUsedAt: nowMs });
}

/**
 * A stable per-guest identifier, used as the Cloudflare
 * `custom_participant_id` so a reconnecting guest is recognised as the same
 * person. Same shape and same purpose as the one-off event's; it never escapes
 * the server-issued participant token.
 */
function generateGuestSub(): string {
  return generateShareId();
}

// ---------------------------------------------------------------------------
// The roster
//
// An invitee row points at the **series**, never at one of its occurrences.
// Invite someone once and they are invited to all of it; they RSVP once for
// the whole thing; removing them removes them from all of it. That is what
// makes a recurring meeting one commitment rather than fifty.
// ---------------------------------------------------------------------------

/**
 * Put people on a series' roster and tell them.
 *
 * Lives outside `addInvitees` because the create form hands its roster
 * straight to `eventSeries.create`: an organizer who picked people and pressed
 * Create once should get one transaction, not a series that exists and
 * invitations that may or may not have followed it. Authorization stays with
 * the caller — `addInvitees` narrows to the organizer, `create` *is* the
 * organizer by construction.
 *
 * Returns how many rows were actually added, which is what tells a caller
 * whether there is anything worth writing to the audit log.
 */
async function inviteToSeries(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  actorId: Id<"users">,
  invitees: { userIds: Id<"users">[]; guestEmails: string[] },
): Promise<number> {
  const existing = await loadSeriesInviteeRows(ctx, series._id);
  const existingUsers = new Set(
    existing
      .map((r) => r.userId)
      .filter((u): u is Id<"users"> => u !== undefined),
  );
  const existingEmails = new Set(
    existing
      .map((r) => r.guestEmail)
      .filter((e): e is string => e !== undefined),
  );

  const newUsers = Array.from(new Set(invitees.userIds)).filter(
    (u) => u !== actorId && !existingUsers.has(u),
  );
  const newEmails = Array.from(
    new Set(invitees.guestEmails.map(normalizeEmail)),
  ).filter((e) => !existingEmails.has(e));

  if (existing.length + newUsers.length + newEmails.length > MAX_INVITEES) {
    throw new ConvexError(`Cannot invite more than ${MAX_INVITEES} people`);
  }

  for (const uid of newUsers) {
    const m = await getWorkspaceMembership(ctx, series.workspaceId, uid);
    if (!m) throw new ConvexError("Invitee is not a member of this workspace");
    await ctx.db.insert("eventSeriesInvitees", {
      seriesId: series._id,
      workspaceId: series.workspaceId,
      userId: uid,
      status: "pending",
      // `originalStartMs` deliberately unset — this row is the series.
    });
  }

  // One share per guest, for the whole series. Guest rows carry no `userId`,
  // so they never reach the member notification below.
  const shareExpiresAt = guestShareExpiryFor(series, Date.now());
  for (const email of newEmails) {
    const shareId = await insertSeriesGuestShare(ctx, {
      seriesId: series._id,
      workspaceId: series.workspaceId,
      createdBy: actorId,
      expiresAt: shareExpiresAt,
    });
    await ctx.db.insert("eventSeriesInvitees", {
      seriesId: series._id,
      workspaceId: series.workspaceId,
      guestEmail: email,
      guestSub: generateGuestSub(),
      status: "pending",
      shareId,
      // `originalStartMs` deliberately unset — this row is the series.
    });
  }

  if (newUsers.length > 0) {
    const inviter = await ctx.db.get(actorId);
    const inviterName = inviter?.name ?? inviter?.email ?? "Someone";
    await notify(ctx, {
      category: "eventInvited",
      userId: actorId,
      userName: inviterName,
      title: "Calendar invitation",
      body: `${inviterName} invited you to ${series.title}`,
      // A **bare** series link: the recipient was invited to the ritual, not
      // to one Tuesday of it, so the link resolves to whichever occurrence is
      // next when they open it rather than to a date that may be long past.
      url: seriesUrl(series),
      recipientIds: newUsers,
    });
  }

  const addedCount = newUsers.length + newEmails.length;
  // Nobody new: no mail run at all, so creating a repeating event with an
  // empty roster stays as silent as it has always been.
  if (addedCount === 0) return 0;

  // One invitation each, carrying the whole repeating pattern — the rule,
  // the exclusions, and every occurrence already moved — so the recipient's
  // mail client files one recurring entry rather than fifty messages.
  await sendSeriesIcsMail(ctx, {
    seriesId: series._id,
    actorId,
    kind: "invited",
    onlyUserIds: newUsers,
    onlyGuestEmails: newEmails,
  });

  return addedCount;
}

export const addInvitees = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    userIds: v.array(v.id("users")),
    guestEmails: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) throw new ConvexError("Series not found");
    // The workspace rule first, the organizer narrowing second — in that
    // order, exactly as on the one-off event surface.
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertOrganizer(series, userId, membership, "add invitees");

    const addedCount = await inviteToSeries(ctx, series, userId, {
      userIds: args.userIds,
      guestEmails: args.guestEmails,
    });
    if (addedCount > 0) {
      await logActivity(ctx, {
        userId,
        resourceType: "calendarEvents",
        resourceId: series._id,
        action: "invitee_added",
        newValue: String(addedCount),
        resourceName: series.title,
        scope: series.workspaceId,
      });
    }

    return null;
  },
});

/**
 * The organizer puts themselves on the roster of their own series — the same
 * shortcut `calendarEvents.selfInvite` is, at the level a repeating meeting
 * actually has a roster: one row for the whole ritual, never one per Tuesday.
 *
 * Opt-in rather than automatic, and the reason is the graph rather than the
 * guest list. The `eventSeriesInvitees` trigger mirrors each member row into
 * an `invites` edge, so writing the organizer's row at `create` would wire
 * them to every meeting they ever book — an edge that is true of all of them
 * and therefore says nothing about any of them. Left opt-in, the edge means
 * "I am in the room", which is worth drawing.
 */
export const selfInvite = mutation({
  args: { seriesId: v.id("eventSeries") },
  returns: v.null(),
  handler: async (ctx, { seriesId }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    // The workspace rule first, the organizer narrowing second — in that
    // order, exactly as on the one-off event surface.
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertOrganizer(series, userId, membership, "self-invite");

    // Idempotent: a second click is not a second row.
    const existing = await ctx.db
      .query("eventSeriesInvitees")
      .withIndex("by_series_user", (q) =>
        q.eq("seriesId", seriesId).eq("userId", userId),
      )
      .first();
    if (existing) return null;

    // Counted against the same cap as `addInvitees`, so the roster cannot be
    // filled to the limit and then stepped past by self-inviting.
    const rows = await loadSeriesInviteeRows(ctx, seriesId);
    if (rows.length + 1 > MAX_INVITEES) {
      throw new ConvexError(`Cannot invite more than ${MAX_INVITEES} people`);
    }

    await ctx.db.insert("eventSeriesInvitees", {
      seriesId,
      workspaceId: series.workspaceId,
      userId,
      status: "accepted",
      respondedAt: Date.now(),
      // `originalStartMs` deliberately unset — this row is the series.
    });
    // Deliberately no `notify`, and no `sendSeriesIcsMail`: the point of the
    // shortcut is that nobody is told, the organizer least of all. They are
    // standing in the room they booked; there is nothing to announce and
    // nothing to answer.
    return null;
  },
});

/**
 * A guest's RSVP, arriving through their link rather than through a session.
 * One answer for the series, exactly as a member's is.
 */
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
    if (share.resourceType !== "eventSeries") {
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
      .query("eventSeriesInvitees")
      .withIndex("by_share", (q) => q.eq("shareId", shareId))
      .first();
    if (!invitee) throw new ConvexError("Invitee record not found");

    const series = await ctx.db.get(invitee.seriesId);
    if (!series) throw new ConvexError("Series is no longer scheduled");

    await extendGuestShareOnUse(ctx, share, series, now);

    await ctx.db.patch(invitee._id, {
      status,
      respondedAt: now,
      guestName: name,
    });

    await notify(ctx, {
      category: "eventResponseChanged",
      userId: series.createdBy,
      userName: name,
      title: "Event RSVP",
      body: `${name} (guest) ${status} your invitation to ${series.title}`,
      url: seriesUrl(series),
      recipientIds: [series.createdBy],
    });

    return null;
  },
});

/**
 * Remove someone from the series — from all of it, in one action, because the
 * row was never filed under one occurrence to begin with.
 */
export const removeInvitee = mutation({
  args: { inviteeId: v.id("eventSeriesInvitees") },
  returns: v.null(),
  handler: async (ctx, { inviteeId }) => {
    const invitee = await ctx.db.get(inviteeId);
    if (!invitee) return null;
    const series = await ctx.db.get(invitee.seriesId);
    if (!series) throw new ConvexError("Series not found");
    // The workspace rule first, the organizer narrowing second — the gate
    // comes off the loaded series, since the arg is a roster row.
    const { userId, membership } = await requireWorkspaceMember(
      ctx,
      series.workspaceId,
    );
    assertOrganizer(series, userId, membership, "remove invitees");

    // A guest's link goes with them. Revoked rather than deleted, so a link
    // already in someone's inbox lands on the ordinary "no longer available"
    // page instead of looking like it never existed.
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

    await logActivity(ctx, {
      userId,
      resourceType: "calendarEvents",
      resourceId: series._id,
      action: "invitee_removed",
      resourceName: series.title,
      scope: series.workspaceId,
    });

    return null;
  },
});

/**
 * RSVP to the **series**: one answer covering every occurrence, because that
 * is the commitment the invitee is actually being asked about. There is no
 * per-occurrence answer to give — see the `originalStartMs` note on the row.
 */
export const respond = mutation({
  args: { seriesId: v.id("eventSeries"), status: rsvpStatusValidator },
  returns: v.null(),
  handler: async (ctx, { seriesId, status }) => {
    const series = await ctx.db.get(seriesId);
    if (!series) throw new ConvexError("Series not found");
    // The workspace rule first, the invitee row second. Nothing deletes those
    // rows on offboarding, so on their own they outlive the membership.
    const { userId } = await requireWorkspaceMember(ctx, series.workspaceId);

    const invitee = await ctx.db
      .query("eventSeriesInvitees")
      .withIndex("by_series_user", (q) =>
        q.eq("seriesId", seriesId).eq("userId", userId),
      )
      .first();
    if (!invitee) throw new ConvexError("You are not invited to this series");

    if (invitee.status === status) return null;
    await ctx.db.patch(invitee._id, { status, respondedAt: Date.now() });

    // Notify the organizer (skip self-RSVP).
    if (series.createdBy !== userId) {
      const responder = await ctx.db.get(userId);
      const name = responder?.name ?? responder?.email ?? "Someone";
      await notify(ctx, {
        category: "eventResponseChanged",
        userId,
        userName: name,
        title: "Event RSVP",
        body: `${name} ${status} your invitation to ${series.title}`,
        url: seriesUrl(series),
        recipientIds: [series.createdBy],
      });
    }

    return null;
  },
});