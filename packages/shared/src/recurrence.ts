/**
 * Recurring calendar events: the pure core.
 *
 * A **series** is a rule plus a local anchor (date, wall-clock time, IANA
 * timezone) and a duration. Its **occurrences** are computed here, never
 * stored — see ADR 0002. This module imports Temporal and nothing else: no
 * Convex, no React, no DOM, so its interface is the test surface.
 *
 * Occurrences are wall-clock in the series' timezone, which is the whole
 * reason the anchor is a local date and time rather than an instant: a 09:00
 * standup stays at 09:00 across a daylight-saving transition instead of
 * drifting by an hour for half the year.
 */
import { Temporal } from "temporal-polyfill";

/**
 * The bounds that keep an open-ended rule from becoming an open-ended read.
 * Each is a refusal the user sees, never a silent trim.
 */
export const RECURRENCE_LIMITS = {
  /** How far past a reference instant a series is ever considered to run. */
  horizonMonths: 24,
  /** Occurrences one window may yield before the read is refused. */
  occurrencesPerWindow: 366,
  /** Cancelled occurrences one series may carry. */
  excludedStarts: 200,
  /** How long a series may run, measured from its anchor. */
  seriesSpanYears: 10,
} as const;

export type RecurrenceLimit = keyof typeof RECURRENCE_LIMITS;

/** A rule that asks for more than the product is willing to serve. */
export class RecurrenceLimitError extends Error {
  constructor(
    readonly limit: RecurrenceLimit,
    message: string,
  ) {
    super(message);
    this.name = "RecurrenceLimitError";
  }
}

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** iCalendar's two-letter weekday codes, by Temporal `dayOfWeek`. */
const ICS_WEEKDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Temporal's `dayOfWeek`: 1 = Monday … 7 = Sunday. */
const WEEKDAY_NUMBER: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "onDate"; date: string }
  | { kind: "afterCount"; count: number };

export type RecurrenceRule = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  /** Weekly only. */
  weekdays?: Weekday[];
  /** Monthly only. */
  monthlyMode?: "dayOfMonth" | "nthWeekday";
  end: RecurrenceEnd;
};

export interface SeriesAnchor {
  /** Local calendar date in `timezone`, "YYYY-MM-DD". */
  date: string;
  /** Local wall-clock time in `timezone`, "HH:mm". */
  time: string;
  timezone: string;
  durationMs: number;
}

export interface SeriesDefinition {
  anchor: SeriesAnchor;
  rule: RecurrenceRule;
  /**
   * Original starts of cancelled occurrences — iCalendar's EXDATE. A cancelled
   * occurrence costs no row of any kind.
   */
  excludedStarts?: number[];
  /**
   * Original starts of occurrences that have become overrides. Their own
   * stored rows carry them at whatever time they were moved to, so expanding
   * the rule here as well would show the meeting twice.
   */
  overriddenStarts?: number[];
}

export interface Occurrence {
  /** The instant the rule places this occurrence at — its name, forever. */
  originalStartMs: number;
  startsAt: number;
  endsAt: number;
}

export interface ExpansionWindow {
  windowStartMs: number;
  windowEndMs: number;
}

function anchorTime(anchor: SeriesAnchor): Temporal.PlainTime {
  return Temporal.PlainTime.from(anchor.time);
}

function localDateAt(ms: number, timezone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(ms)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
}

/**
 * The occurrence the rule places on `date`. `disambiguation: "compatible"` is
 * Temporal's default and is what Google and Outlook do: push forward into a
 * spring-forward gap, take the earlier of a repeated autumn hour.
 */
function occurrenceOn(anchor: SeriesAnchor, date: Temporal.PlainDate): Occurrence {
  const startsAt = date.toZonedDateTime({
    timeZone: anchor.timezone,
    plainTime: anchorTime(anchor),
  }).epochMilliseconds;
  return { originalStartMs: startsAt, startsAt, endsAt: startsAt + anchor.durationMs };
}

function startOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

/**
 * Every date a weekly rule places an occurrence on, from `fromDate` onward,
 * without end. Callers break out; nothing here decides where a series stops.
 *
 * The scan jumps straight to the first week of the cycle that could contain
 * `fromDate`, so a window years after the anchor costs no more than one beside
 * it.
 */
function* weeklyDates(
  series: SeriesDefinition,
  fromDate: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  const { anchor, rule } = series;
  const anchorDate = Temporal.PlainDate.from(anchor.date);
  const weekdays = (rule.weekdays ?? [])
    .map((w) => WEEKDAY_NUMBER[w])
    .sort((a, b) => a - b);
  if (weekdays.length === 0) return;

  const anchorWeek = startOfWeek(anchorDate);
  const scanFrom =
    Temporal.PlainDate.compare(fromDate, anchorDate) < 0 ? anchorDate : fromDate;
  const weeksApart = anchorWeek.until(startOfWeek(scanFrom), {
    largestUnit: "weeks",
  }).weeks;
  const skip = Math.max(0, Math.floor(weeksApart / rule.interval) * rule.interval);

  for (
    let week = anchorWeek.add({ weeks: skip });
    ;
    week = week.add({ weeks: rule.interval })
  ) {
    for (const weekday of weekdays) {
      const date = week.add({ days: weekday - 1 });
      if (Temporal.PlainDate.compare(date, anchorDate) >= 0) yield date;
    }
  }
}

function* dailyDates(
  series: SeriesDefinition,
  fromDate: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  const interval = series.rule.interval;
  const daysApart = anchorDate.until(fromDate, { largestUnit: "days" }).days;
  const skip = Math.max(0, Math.floor(daysApart / interval) * interval);

  for (let date = anchorDate.add({ days: skip }); ; date = date.add({ days: interval })) {
    yield date;
  }
}

/**
 * A yearly series happens on its own local date and nowhere else: a 29
 * February series skips non-leap years rather than sliding to the 28th, which
 * is why the month and day are re-asserted rather than added to.
 */
function* yearlyDates(
  series: SeriesDefinition,
  fromDate: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  const interval = series.rule.interval;
  const yearsApart = fromDate.year - anchorDate.year;
  const skip = Math.max(0, Math.floor(yearsApart / interval) * interval);

  for (let year = anchorDate.year + skip; ; year += interval) {
    const date = plainDateOrNull(year, anchorDate.month, anchorDate.day);
    if (date) yield date;
  }
}

/** The date, or null when that year or month simply has no such day. */
function plainDateOrNull(
  year: number,
  month: number,
  day: number,
): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

/**
 * A monthly series happens on its own day of the month, or on its own nth
 * weekday — and in a month that has neither, it simply does not happen. It
 * never slides to the nearest available day: "the 31st" and "the fifth
 * Tuesday" both mean months without one are skipped, which is what iCalendar
 * does and what an organizer means.
 */
function* monthlyDates(
  series: SeriesDefinition,
  fromDate: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  const interval = series.rule.interval;
  const byNthWeekday = series.rule.monthlyMode === "nthWeekday";
  const nth = Math.ceil(anchorDate.day / 7);

  const anchorMonth = anchorDate.toPlainYearMonth();
  const monthsApart = anchorMonth.until(fromDate.toPlainYearMonth(), {
    largestUnit: "months",
  }).months;
  const skip = Math.max(0, Math.floor(monthsApart / interval) * interval);

  for (
    let month = anchorMonth.add({ months: skip });
    ;
    month = month.add({ months: interval })
  ) {
    const date = byNthWeekday
      ? nthWeekdayOf(month, anchorDate.dayOfWeek, nth)
      : plainDateOrNull(month.year, month.month, anchorDate.day);
    if (date) yield date;
  }
}

/** The nth `weekday` of that month, or null when the month has fewer. */
function nthWeekdayOf(
  month: Temporal.PlainYearMonth,
  weekday: number,
  nth: number,
): Temporal.PlainDate | null {
  const first = month.toPlainDate({ day: 1 });
  const day = 1 + ((weekday - first.dayOfWeek + 7) % 7) + (nth - 1) * 7;
  return day > month.daysInMonth ? null : month.toPlainDate({ day });
}

/** Every date the rule places an occurrence on, from `fromDate` onward. */
function ruleDates(
  series: SeriesDefinition,
  fromDate: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  switch (series.rule.freq) {
    case "daily":
      return dailyDates(series, fromDate);
    case "weekly":
      return weeklyDates(series, fromDate);
    case "monthly":
      return monthlyDates(series, fromDate);
    case "yearly":
      return yearlyDates(series, fromDate);
    default:
      return (function* () {})();
  }
}

/**
 * The last date the series may place an occurrence on, or null when the rule
 * names no end. A count is counted from the **anchor**, never from the window
 * being asked about, so scrolling the calendar cannot change how long a series
 * runs.
 *
 * The walk for a count stops at the span cap rather than running the count out.
 * A count is a number an organizer types, so it can be a hundred million by
 * accident — and answering that by placing a hundred million dates is not slow,
 * it is a hang. Stopping there hands `validateSeries` a date past the span,
 * which is exactly the refusal such a rule deserves; every rule that could
 * legitimately be saved reaches its count first and is unaffected.
 */
function lastDate(series: SeriesDefinition): Temporal.PlainDate | null {
  const { end } = series.rule;
  if (end.kind === "never") return null;
  if (end.kind === "onDate") return Temporal.PlainDate.from(end.date);

  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  const spanLimit = anchorDate.add({ years: RECURRENCE_LIMITS.seriesSpanYears });
  let seen = 0;
  for (const date of ruleDates(series, anchorDate)) {
    if (++seen === end.count) return date;
    if (Temporal.PlainDate.compare(date, spanLimit) > 0) return date;
  }
  return null;
}

/**
 * Every occurrence of `series` whose time falls inside the window, in
 * chronological order.
 */
export function expandSeries(
  series: SeriesDefinition,
  window: ExpansionWindow,
): Occurrence[] {
  if (window.windowEndMs <= window.windowStartMs) return [];
  const { anchor } = series;

  const last = lastDate(series);
  const windowEndDate = localDateAt(window.windowEndMs, anchor.timezone);
  const scanEnd =
    last && Temporal.PlainDate.compare(last, windowEndDate) < 0 ? last : windowEndDate;

  // An occurrence may start before the window and end inside it, so the scan
  // opens a duration early rather than on the window's own first date.
  const scanFrom = localDateAt(
    window.windowStartMs - anchor.durationMs,
    anchor.timezone,
  );

  const handledElsewhere = new Set([
    ...(series.excludedStarts ?? []),
    ...(series.overriddenStarts ?? []),
  ]);

  const occurrences: Occurrence[] = [];
  for (const date of ruleDates(series, scanFrom)) {
    if (Temporal.PlainDate.compare(date, scanEnd) > 0) break;
    const occurrence = occurrenceOn(anchor, date);
    if (handledElsewhere.has(occurrence.originalStartMs)) continue;
    if (
      occurrence.endsAt > window.windowStartMs &&
      occurrence.startsAt < window.windowEndMs
    ) {
      if (occurrences.length === RECURRENCE_LIMITS.occurrencesPerWindow) {
        throw new RecurrenceLimitError(
          "occurrencesPerWindow",
          `This view would show more than ${RECURRENCE_LIMITS.occurrencesPerWindow} occurrences. Narrow the range or the rule.`,
        );
      }
      occurrences.push(occurrence);
    }
  }
  return occurrences.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * The end of the series' last occurrence, or null when the rule names no end.
 * Unclamped by the horizon, because this answers "when does this rule stop"
 * rather than "how far may a read go" — a series ending in five years must not
 * be recorded as ending at the two-year horizon.
 */
export function lastOccurrenceEndsAt(series: SeriesDefinition): number | null {
  // The last *occurrence*, not the rule's end date — "ends on 2 September" on
  // a yearly series anchored to 1 September stops at the 1st, and reading the
  // end date as an occurrence would report a meeting that never happens.
  const start = lastOccurrenceStart(series);
  return start === null ? null : start + series.anchor.durationMs;
}

/**
 * The instant after which the series has nothing left — its last occurrence's
 * end, or the **horizon** when the rule names no end. An open-ended series is
 * a statement about the rule, not a licence for an unbounded read: everything
 * that needs an end (a guest share's expiry, the fallback for a link to a
 * finished series) gets one from here.
 */
export function seriesEndsAt(series: SeriesDefinition, fromMs: number): number {
  const { anchor } = series;
  const horizon = Temporal.Instant.fromEpochMilliseconds(fromMs)
    .toZonedDateTimeISO(anchor.timezone)
    .add({ months: RECURRENCE_LIMITS.horizonMonths }).epochMilliseconds;

  const last = lastOccurrenceEndsAt(series);
  return last === null ? horizon : Math.min(last, horizon);
}

/**
 * How many occurrences the series has in total, or null when the rule names no
 * end — an open-ended series has no count, and reporting the horizon's worth
 * would be a number the organizer never asked for.
 *
 * Counted over the series' whole life rather than over a window, because this
 * answers the authoring question ("how many invitations is this?") rather than
 * the reading one. It terminates for every bounded rule: the span cap that
 * `validateSeries` enforces is what keeps the walk short.
 */
export function countOccurrences(series: SeriesDefinition): number | null {
  const last = lastDate(series);
  if (!last) return null;

  // A cancelled occurrence is not one of the series' occurrences — it costs no
  // row and nobody is expected at it, so it must not be counted as one either.
  const excluded = new Set(series.excludedStarts ?? []);

  let count = 0;
  for (const date of ruleDates(series, Temporal.PlainDate.from(series.anchor.date))) {
    if (Temporal.PlainDate.compare(date, last) > 0) break;
    if (!excluded.has(occurrenceOn(series.anchor, date).originalStartMs)) count++;
  }
  return count;
}

export type SeriesRejection =
  | "seriesSpanYears"
  | "excludedStarts"
  | "interval"
  | "weekdays";

export type SeriesValidation =
  | { ok: true }
  | { ok: false; reason: SeriesRejection; message: string };

/**
 * Whether a series may be saved. A question rather than an exception, because
 * the create form asks it on every keystroke — the mutation is the one that
 * turns a rejection into an error.
 *
 * The span cap applies only to a rule that names its own end. A series with no
 * end is not "infinite": nothing ever reads past the horizon, so there is no
 * span to cap.
 */
export function validateSeries(series: SeriesDefinition): SeriesValidation {
  const { rule, anchor } = series;

  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    return {
      ok: false,
      reason: "interval",
      message: "A repeat interval must be a whole number of at least 1.",
    };
  }

  if (rule.freq === "weekly" && (rule.weekdays ?? []).length === 0) {
    return {
      ok: false,
      reason: "weekdays",
      message: "A weekly repeat needs at least one weekday.",
    };
  }

  if ((series.excludedStarts ?? []).length > RECURRENCE_LIMITS.excludedStarts) {
    return {
      ok: false,
      reason: "excludedStarts",
      message: `A series can skip at most ${RECURRENCE_LIMITS.excludedStarts} occurrences. Consider changing the rule instead.`,
    };
  }

  const last = lastDate(series);
  if (last) {
    const spanLimit = Temporal.PlainDate.from(anchor.date).add({
      years: RECURRENCE_LIMITS.seriesSpanYears,
    });
    if (Temporal.PlainDate.compare(last, spanLimit) > 0) {
      return {
        ok: false,
        reason: "seriesSpanYears",
        message: `A series can run for at most ${RECURRENCE_LIMITS.seriesSpanYears} years.`,
      };
    }
  }

  return { ok: true };
}

/** "20260908T070000Z" — iCalendar's UTC form. */
function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The last occurrence a bounded rule places, or null when it names no end. */
function lastOccurrenceStart(series: SeriesDefinition): number | null {
  const last = lastDate(series);
  if (!last) return null;
  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  let latest: Temporal.PlainDate | null = null;
  for (const date of ruleDates(series, anchorDate)) {
    if (Temporal.PlainDate.compare(date, last) > 0) break;
    latest = date;
  }
  return latest ? occurrenceOn(series.anchor, latest).startsAt : null;
}

/**
 * Where the series starts: the first occurrence the **rule** places, which is
 * not always the anchor date — a weekly rule anchored on a Tuesday but
 * repeating on Thursdays starts that Thursday.
 *
 * Cancelled starts are deliberately not skipped. This is the instant an
 * iCalendar `DTSTART` has to name, and the recurrence set is anchored there
 * whether or not that first one still happens; `EXDATE` is what removes it.
 * Moving `DTSTART` past a cancellation would shift every occurrence after it.
 *
 * `null` only for a rule that can place nothing at all — a weekly rule with no
 * weekdays, which `validateSeries` refuses at save time.
 */
export function firstOccurrence(series: SeriesDefinition): Occurrence | null {
  const anchorDate = Temporal.PlainDate.from(series.anchor.date);
  const last = lastDate(series);
  // The same horizon every other read here answers to: a generator that keeps
  // skipping (a monthly 31st, a yearly 29 February) must not be able to walk
  // forever looking for a date it will never produce.
  const scanEnd = anchorDate.add({ months: RECURRENCE_LIMITS.horizonMonths });
  for (const date of ruleDates(series, anchorDate)) {
    if (Temporal.PlainDate.compare(date, scanEnd) > 0) return null;
    if (last && Temporal.PlainDate.compare(date, last) > 0) return null;
    return occurrenceOn(series.anchor, date);
  }
  return null;
}

/**
 * The rule as an iCalendar `RRULE` value. Text is a wire format produced here
 * and never parsed back — the structured rule is the model.
 */
export function toRRule(series: SeriesDefinition): string {
  const { rule, anchor } = series;
  const anchorDate = Temporal.PlainDate.from(anchor.date);
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];

  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);

  switch (rule.freq) {
    case "weekly": {
      const days = (rule.weekdays ?? [])
        .map((w) => WEEKDAY_NUMBER[w])
        .sort((a, b) => a - b)
        .map((n) => ICS_WEEKDAY[n - 1]);
      if (days.length > 0) parts.push(`BYDAY=${days.join(",")}`);
      break;
    }
    case "monthly":
      if (rule.monthlyMode === "nthWeekday") {
        const nth = Math.ceil(anchorDate.day / 7);
        parts.push(`BYDAY=${nth}${ICS_WEEKDAY[anchorDate.dayOfWeek - 1]}`);
      } else {
        parts.push(`BYMONTHDAY=${anchorDate.day}`);
      }
      break;
    case "yearly":
      parts.push(`BYMONTH=${anchorDate.month}`, `BYMONTHDAY=${anchorDate.day}`);
      break;
    case "daily":
      break;
  }

  if (rule.end.kind === "afterCount") {
    parts.push(`COUNT=${rule.end.count}`);
  } else if (rule.end.kind === "onDate") {
    const until = lastOccurrenceStart(series);
    if (until !== null) parts.push(`UNTIL=${icsStamp(until)}`);
  }

  return parts.join(";");
}

/**
 * Cancelled occurrences as an iCalendar `EXDATE` value, or null when the
 * series has skipped nothing.
 */
export function toExDate(series: SeriesDefinition): string | null {
  const excluded = [...(series.excludedStarts ?? [])].sort((a, b) => a - b);
  return excluded.length === 0 ? null : excluded.map(icsStamp).join(",");
}

/**
 * How many occurrences the series still has after `fromMs`, or null when the
 * rule names no end.
 *
 * The null is the same statement `countOccurrences` makes: an open-ended
 * series has no count, and the horizon's worth would be a number the organizer
 * never chose. This is what the occurrence view says out loud — "and 11 more
 * after this one" — so that a viewer knows what they are looking at without
 * having to open the pattern.
 */
export function remainingOccurrences(
  series: SeriesDefinition,
  fromMs: number,
): number | null {
  const last = lastDate(series);
  if (!last) return null;

  const excluded = new Set(series.excludedStarts ?? []);
  let count = 0;
  for (const date of ruleDates(series, Temporal.PlainDate.from(series.anchor.date))) {
    if (Temporal.PlainDate.compare(date, last) > 0) break;
    const occurrence = occurrenceOn(series.anchor, date);
    if (excluded.has(occurrence.originalStartMs)) continue;
    if (occurrence.startsAt >= fromMs) count++;
  }
  return count;
}

/**
 * What an edit touches: how many occurrences, and the instants that decide
 * whether anybody needs telling.
 */
export interface EditReach {
  /**
   * Occurrences in the edit's scope, or null when the rule names no end — the
   * same null `countOccurrences` gives, and for the same reason.
   */
  occurrenceCount: number | null;
  /**
   * Occurrence starts in the edit's scope, for `affectsOnlyThePast`. The first
   * and the last, not every one: the predicate turns on the latest, and an
   * open-ended rule has infinitely many.
   */
  instants: number[];
}

/**
 * The reach of an edit to `series`, scoped from `fromOriginalStartMs` onward —
 * omit it for "all occurrences", pass the split point for "this and following".
 *
 * Both halves of the notification decision come from here: the count is what
 * the organizer's prompt has to name ("2 invitees, 5 occurrences"), and the
 * instants are what `affectsOnlyThePast` weighs to decide whether to prompt at
 * all. One function, called by the client prompt and by the server's safety
 * net, so the two cannot drift.
 *
 * An **open-ended** rule reports no count and reports the horizon as its last
 * instant. That is the honest answer to both questions: nobody chose a number,
 * and there is always another occurrence ahead of now.
 */
export function reachOfEdit(
  series: SeriesDefinition,
  nowMs: number,
  fromOriginalStartMs?: number,
): EditReach {
  const from = fromOriginalStartMs ?? Number.NEGATIVE_INFINITY;
  const last = lastDate(series);
  if (!last) {
    return { occurrenceCount: null, instants: [seriesEndsAt(series, nowMs)] };
  }

  const excluded = new Set(series.excludedStarts ?? []);
  let count = 0;
  let first: number | null = null;
  let latest = 0;
  for (const date of ruleDates(series, Temporal.PlainDate.from(series.anchor.date))) {
    if (Temporal.PlainDate.compare(date, last) > 0) break;
    const occurrence = occurrenceOn(series.anchor, date);
    if (excluded.has(occurrence.originalStartMs)) continue;
    if (occurrence.originalStartMs < from) continue;
    count++;
    if (first === null) first = occurrence.startsAt;
    latest = occurrence.startsAt;
  }
  return {
    occurrenceCount: count,
    instants: first === null ? [] : [first, latest],
  };
}

/**
 * Where a **bare** link to a series lands: the first occurrence starting at or
 * after `fromMs`, and — once the series has ended — its last one instead.
 *
 * The fallback is the whole point. A notification about the series carries no
 * original-start coordinate, and a link that resolved to nothing once the last
 * Tuesday had passed would turn every old message about the standup into a
 * dead page. `null` comes back only for a series with no occurrences at all,
 * which is a rule whose every occurrence has been cancelled.
 *
 * Bounded like every other read here: the forward search stops at the horizon,
 * so an open-ended rule cannot walk forever.
 */
export function nextOccurrenceFrom(
  series: SeriesDefinition,
  fromMs: number,
): Occurrence | null {
  const { anchor } = series;
  const excluded = new Set(series.excludedStarts ?? []);
  const last = lastDate(series);
  const horizonDate = Temporal.Instant.fromEpochMilliseconds(fromMs)
    .toZonedDateTimeISO(anchor.timezone)
    .add({ months: RECURRENCE_LIMITS.horizonMonths })
    .toPlainDate();
  const scanEnd =
    last && Temporal.PlainDate.compare(last, horizonDate) < 0 ? last : horizonDate;

  let previous: Occurrence | null = null;
  for (const date of ruleDates(series, Temporal.PlainDate.from(anchor.date))) {
    if (Temporal.PlainDate.compare(date, scanEnd) > 0) break;
    const occurrence = occurrenceOn(anchor, date);
    if (excluded.has(occurrence.originalStartMs)) continue;
    if (occurrence.startsAt >= fromMs) return occurrence;
    previous = occurrence;
  }
  // Nothing upcoming: the series has run out, so its last occurrence is the
  // most honest thing a bare link can open.
  return previous;
}

export interface SeriesSplit {
  /**
   * The original series, ending before the split — or null when the split is
   * at the very first occurrence, in which case nothing precedes it and the
   * caller is really editing the whole series.
   */
  truncated: SeriesDefinition | null;
  /** The second series, carrying the change from the split onward. */
  continuation: SeriesDefinition;
}

/**
 * "This and following": truncate the series before `atOriginalStartMs` and
 * hand back a second series starting there. The continuation is a genuinely
 * separate resource — its own id, node, share links and mention target — which
 * is why this returns two definitions rather than mutating one.
 */
export function splitSeries(
  series: SeriesDefinition,
  atOriginalStartMs: number,
): SeriesSplit {
  const { anchor, rule } = series;
  const splitDate = localDateAt(atOriginalStartMs, anchor.timezone);

  let precedingCount = 0;
  for (const date of ruleDates(series, Temporal.PlainDate.from(anchor.date))) {
    if (occurrenceOn(anchor, date).originalStartMs >= atOriginalStartMs) break;
    precedingCount++;
  }

  const before = (ms: number) => ms < atOriginalStartMs;
  const partition = (starts: number[] | undefined, keep: (ms: number) => boolean) => {
    const kept = (starts ?? []).filter(keep);
    return kept.length > 0 ? kept : undefined;
  };

  const continuation: SeriesDefinition = {
    anchor: { ...anchor, date: splitDate.toString() },
    rule: {
      ...rule,
      end:
        rule.end.kind === "afterCount"
          ? { kind: "afterCount", count: rule.end.count - precedingCount }
          : rule.end,
    },
    excludedStarts: partition(series.excludedStarts, (ms) => !before(ms)),
    overriddenStarts: partition(series.overriddenStarts, (ms) => !before(ms)),
  };

  if (precedingCount === 0) return { truncated: null, continuation };

  return {
    truncated: {
      anchor,
      rule: {
        ...rule,
        end: { kind: "onDate", date: splitDate.subtract({ days: 1 }).toString() },
      },
      excludedStarts: partition(series.excludedStarts, before),
      overriddenStarts: partition(series.overriddenStarts, before),
    },
    continuation,
  };
}

/**
 * Whether every instant an edit touches has already happened — the reason not
 * to mail anyone. An organizer shuffling last quarter's standups is cleaning
 * up history, not changing anyone's plans.
 *
 * Pass every instant the edit moves *from* as well as *to*: moving a past
 * occurrence into the future very much changes someone's plans. Nothing
 * affected means nothing to tell anyone about.
 */
export function affectsOnlyThePast(instants: number[], nowMs: number): boolean {
  return instants.every((ms) => ms < nowMs);
}
