// Pure helpers for the My Calendar tab. Kept separate from the React tab
// component so they can be unit-tested without spinning up schedule-x.

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

/** Convert an ms timestamp to a YYYY-MM-DDTHH:mm string in the local tz —
 *  matches the value shape of an `<input type="datetime-local">` field. */
export function toLocalDateTimeInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Inverse of toLocalDateTimeInput — interprets the datetime-local value in
 *  the local timezone and returns ms since epoch. */
export function fromLocalDateTimeInput(value: string): number {
  // `new Date("YYYY-MM-DDTHH:mm")` parses as local time (no Z), which is what
  // we want. Returning getTime() converts to absolute ms.
  return new Date(value).getTime();
}
