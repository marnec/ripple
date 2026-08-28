// Pure helpers for the My Calendar tab. Kept separate from the React tab
// component so they can be unit-tested without spinning up schedule-x.

import type { Temporal } from "temporal-polyfill";

export type JoinWindowStatus =
  | "pending"     // too early — call hasn't opened yet
  | "open"        // join button visible/active
  | "ended";      // past the tail window

export const JOIN_WINDOW_LEAD_MS = 5 * 60 * 1000;
export const JOIN_WINDOW_TAIL_MS = 15 * 60 * 1000;

/**
 * Returns whether a user can join the call right now, based on the join
 * window (start − 5min … end + 15min). Mirrors the server-side check.
 */
export function joinWindowStatus(
  startsAt: number,
  endsAt: number,
  now: number,
): JoinWindowStatus {
  if (now < startsAt - JOIN_WINDOW_LEAD_MS) return "pending";
  if (now > endsAt + JOIN_WINDOW_TAIL_MS) return "ended";
  return "open";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma- / whitespace-separated string into normalised email chips.
 *  Used by InviteeMultiSelect to accept "alice@x.com bob@y.com" pastes. */
export function parseEmailChips(raw: string): {
  valid: string[];
  invalid: string[];
} {
  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (EMAIL_RE.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid: Array.from(new Set(valid)), invalid };
}


export type CalendarRangeLabels = {
  /** Full form — desktop. Week view spells out the whole range. */
  full: string;
  /** Compact form — mobile. Week view collapses to month + year, because
   *  "May 4 – 10, 2026" eats the whole toolbar row next to the nav
   *  buttons and the tab switch. */
  compact: string;
};

/**
 * Range label for the dashboard calendar nav.
 *
 * The week-view compact form uses the month/year of the week's centre day
 * (Thursday) so a Mon–Sun week straddling a month boundary gets a sensible
 * single-month label rather than a misleading start-month-only one.
 *
 * `date` is `null` before the calendar mounts — both labels are empty then,
 * so the nav reserves its space without flashing a wrong range.
 */
export function formatCalendarRangeLabels(
  date: Temporal.PlainDate | null,
  isMonthView: boolean,
): CalendarRangeLabels {
  if (!date) return { full: "", compact: "" };

  if (isMonthView) {
    const full = date.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    return { full, compact: full };
  }

  const weekStart = date.subtract({ days: date.dayOfWeek - 1 }); // 1 (Mon) … 7 (Sun)
  const weekEnd = weekStart.add({ days: 6 });
  const sameMonth = weekStart.month === weekEnd.month;
  const sameYear = weekStart.year === weekEnd.year;

  // Each part is formatted with only the fields it should show, and the
  // shared year (if any) is appended once at the end. Passing
  // `month: undefined` instead would NOT drop the month — Temporal's
  // toLocaleString renders an unsupported field combination literally
  // ("May 4 – 2026 (day: 10)").
  const startFmt = weekStart.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endFmt = weekEnd.toLocaleString("en-US", {
    ...(sameMonth ? {} : { month: "short" }),
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const trailingYear = sameYear ? `, ${weekEnd.year}` : "";

  const centre = weekStart.add({ days: 3 });
  return {
    full: `${startFmt} – ${endFmt}${trailingYear}`,
    compact: centre.toLocaleString("en-US", { month: "long", year: "numeric" }),
  };
}
