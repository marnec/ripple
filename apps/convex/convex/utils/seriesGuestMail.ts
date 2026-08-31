/**
 * The guest mail a **series** sends.
 *
 * A repeating meeting is one invitation, not one per Tuesday: a single
 * `VEVENT` carrying the rule and the exclusions under a UID derived from the
 * series, plus one `RECURRENCE-ID` `VEVENT` per override so an occurrence that
 * was moved shows at its new time rather than leaving someone in an empty
 * room. The assembly itself lives in `emails.ts`; what lives here is *who* the
 * message goes to and *which* of the three lifecycle messages it is.
 *
 * Deliberately separate from `utils/eventNotifications.ts`. That module speaks
 * the one-off event's vocabulary — a `calendarEvents` doc, a
 * `calendarEventInvitees` index — none of which a series has; widening it
 * would push an `undefined` through every one of its call sites to buy nothing
 * a second module does not.
 *
 * **The SEQUENCE counter lives on the series and nowhere else.** It is bumped
 * here, once per guest-facing change, and the number that goes out is the same
 * one for the master entry and for every override entry in the same message.
 * An override is a `calendarEvents` row and that row has a `sequence` field of
 * its own; it is left unwritten on purpose (spec 0003, "Email and ICS"). Two
 * counters for one UID is how a client ends up ignoring an update.
 */

import {
  firstOccurrence,
  nextOccurrenceFrom,
  toExDate,
  toRRule,
} from "@ripple/shared/recurrence";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { scheduleEmail } from "../emailPool";
import { toSeriesDefinition } from "../lib/seriesOccurrence";

/** Which of the three lifecycle messages this dispatch is. */
export type SeriesMailKind = "invited" | "updated" | "cancelled";

export interface SendSeriesIcsMailArgs {
  seriesId: Id<"eventSeries">;
  /** Whoever made the change — the ICS ORGANIZER name and the email's "from". */
  actorId: Id<"users">;
  kind: SeriesMailKind;
  /** `invited` only: restrict to the people just added. Omitted means the
   *  whole roster, which is what a fresh continuation of a split wants. */
  onlyUserIds?: Id<"users">[];
  /** `invited` only, and the guest half of the same narrowing. */
  onlyGuestEmails?: string[];
  /**
   * A split's continuation. It is mailed as a **fresh invitation** under its
   * own UID in the same breath as the truncated original's update — and no
   * `CANCEL` is sent for the original, because a cancellation makes a client
   * delete the history the organizer never asked to lose (spec 0003, ADR 0002).
   */
  continuationId?: Id<"eventSeries">;
}

function siteUrl(): string {
  return process.env.SITE_URL ?? "";
}

/** The public guest landing URL — one share link for the whole series. */
function shareDeepLink(shareId: string): string {
  return `${siteUrl()}/share/${shareId}`;
}

/**
 * The **bare** in-app link to a series: a member was invited to the ritual,
 * not to one Tuesday of it, so the link resolves to whichever occurrence is
 * next when they open it.
 */
function seriesDeepLink(series: Doc<"eventSeries">): string {
  return `${siteUrl()}/workspaces/${series.workspaceId}/events/${series._id}`;
}

/** Every roster row for a series — bounded by the same invitee cap as writes. */
async function rosterOf(
  ctx: MutationCtx,
  seriesId: Id<"eventSeries">,
): Promise<Doc<"eventSeriesInvitees">[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  return await ctx.db
    .query("eventSeriesInvitees")
    .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
    .collect();
}

/**
 * Every override of a series, as the ICS wants them: identified by the start
 * the rule placed them at, carrying the time they were moved to.
 */
async function overridesOf(
  ctx: MutationCtx,
  seriesId: Id<"eventSeries">,
): Promise<
  Array<{
    originalStartMs: number;
    startsAt: number;
    endsAt: number;
    title: string;
    description?: string;
  }>
> {
  // Bounded by how many occurrences the organizer has customised by hand, the
  // same bound the range read's override suppression already lives with.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const rows = await ctx.db
    .query("calendarEvents")
    .withIndex("by_series_original_start", (q) => q.eq("seriesId", seriesId))
    .collect();
  return rows.flatMap((row) =>
    row.originalStartMs === undefined
      ? []
      : [
          {
            originalStartMs: row.originalStartMs,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            title: row.title,
            description: row.description,
          },
        ],
  );
}

async function actorName(
  ctx: MutationCtx,
  actorId: Id<"users">,
): Promise<string> {
  const actor = await ctx.db.get(actorId);
  return actor?.name ?? actor?.email ?? "Someone";
}

/** A human range for the message body — the next occurrence still to come. */
function formatRange(
  startsAt: number,
  endsAt: number,
  timezone: string,
): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day.format(new Date(startsAt))} – ${time.format(new Date(endsAt))}`;
}

const CATEGORY: Record<SeriesMailKind, "eventInvited" | "eventUpdated" | "eventCancelled"> =
  {
    invited: "eventInvited",
    updated: "eventUpdated",
    cancelled: "eventCancelled",
  };

/**
 * Mail a series' roster about a change, as one calendar entry for the whole
 * pattern.
 *
 * Called at exactly one point in each series mutation that changes something a
 * recipient's calendar holds. Guests are always mailed — a share link is the
 * only calendar they have from us — while members go through the same
 * per-category email preference the one-off event surface honours.
 */
export async function sendSeriesIcsMail(
  ctx: MutationCtx,
  args: SendSeriesIcsMailArgs,
): Promise<void> {
  const series = await ctx.db.get(args.seriesId);
  if (!series) return;

  const definition = toSeriesDefinition(series);
  const first = firstOccurrence(definition);
  // A rule that places nothing has no calendar entry to describe, so there is
  // no message to send — and no DTSTART to hang one on.
  if (!first) return;

  // One counter, on the series. An invitation carries the number the pattern
  // already stands at (bumping for a new attendee would make every *existing*
  // attendee's stored copy look stale); a change bumps it, which is what makes
  // a client apply the update in place rather than filing a duplicate.
  const current = series.sequence ?? 0;
  const sequence = args.kind === "invited" ? current : current + 1;
  if (sequence !== current) {
    // A cancellation is the one bump that is not persisted: the row is on its
    // way out in the same mutation, and patching a document the cascade is
    // about to delete records nothing.
    if (args.kind !== "cancelled") {
      await ctx.db.patch(series._id, { sequence });
    }
  }

  const upcoming = nextOccurrenceFrom(definition, Date.now()) ?? first;
  const inviterName = await actorName(ctx, args.actorId);
  const recurrence = {
    rrule: toRRule(definition),
    exdate: toExDate(definition) ?? undefined,
    timezone: series.timezone,
    // A CANCEL withdraws the whole pattern; naming the moved occurrences
    // separately would only ask the client to reconcile entries it is about to
    // delete.
    overrides:
      args.kind === "cancelled" ? [] : await overridesOf(ctx, series._id),
  };

  const roster = await rosterOf(ctx, series._id);
  const narrowed =
    args.onlyUserIds === undefined && args.onlyGuestEmails === undefined
      ? roster
      : roster.filter(
          (row) =>
            (row.userId !== undefined &&
              (args.onlyUserIds ?? []).includes(row.userId)) ||
            (row.guestEmail !== undefined &&
              (args.onlyGuestEmails ?? []).includes(row.guestEmail)),
        );

  const memberIds = narrowed.flatMap((r) => (r.userId ? [r.userId] : []));
  const wanted =
    memberIds.length > 0
      ? await ctx.runQuery(
          internal.notificationPreferences.filterUsersWantingEmail,
          { userIds: memberIds, category: CATEGORY[args.kind] },
        )
      : [];
  const wantsEmail = new Set(wanted);

  for (const row of narrowed) {
    // Guests land on their share link — the only calendar page they have from
    // us — and members on the bare in-app series link, which resolves to
    // whichever occurrence is next when they open it.
    let email: string | undefined;
    let targetUrl = seriesDeepLink(series);
    if (row.guestEmail) {
      email = row.guestEmail;
      if (row.shareId) targetUrl = shareDeepLink(row.shareId);
    } else if (row.userId && wantsEmail.has(row.userId)) {
      email = (await ctx.db.get(row.userId))?.email ?? undefined;
    }
    if (!email) continue;

    // Untracked on the way out, exactly as a member notified by preference
    // rather than by invitation is: delivery state is a `calendarEventInvitees`
    // column and a series roster row is a different table.
    const job = { kind: `emails:series:${args.kind}`, eventId: series._id };

    if (args.kind === "cancelled") {
      await scheduleEmail(ctx, internal.emails.sendEventCancellation, job, {
        eventId: series._id,
        eventTitle: series.title,
        recipientEmail: email,
        inviterName,
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        sequence,
        recurrence,
      });
    } else if (args.kind === "updated") {
      await scheduleEmail(ctx, internal.emails.sendEventReschedule, job, {
        eventId: series._id,
        eventTitle: series.title,
        recipientEmail: email,
        inviterName,
        newRangeLabel: formatRange(
          upcoming.startsAt,
          upcoming.endsAt,
          series.timezone,
        ),
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        sequence,
        recurrence,
      });
    } else {
      await scheduleEmail(ctx, internal.emails.sendEventInvite, job, {
        eventId: series._id,
        targetUrl,
        recipientEmail: email,
        inviterName,
        eventTitle: series.title,
        eventDescription: series.description,
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        timezone: series.timezone,
        sequence,
        recurrence,
      });
    }
  }

  // The continuation of a split, as a fresh invitation under its own UID. It
  // is a genuinely separate resource — its own id, its own share links — so
  // its roster is mailed in full rather than narrowed.
  if (args.continuationId) {
    await sendSeriesIcsMail(ctx, {
      seriesId: args.continuationId,
      actorId: args.actorId,
      kind: "invited",
    });
  }
}
