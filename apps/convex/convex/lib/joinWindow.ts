/**
 * When a scheduled meeting's call is open.
 *
 * A single home for the two numbers, because they are now asked by three
 * callers that must agree: a one-off event (`calendarEvents`), one occurrence
 * of a series (`eventSeries`), and — through the occurrence a call is stamped
 * with — the call session itself. Two of them disagreeing would show a Join
 * button that the server then refuses, or stamp a call with the occurrence
 * next door.
 *
 * The web copy of these numbers lives in `dashboard-calendar-utils.ts`; it is
 * a separate package and cannot import backend code.
 */

/** Join opens this long before the scheduled start. */
export const JOIN_WINDOW_LEAD_MS = 5 * 60 * 1000;
/** …and closes this long after the scheduled end. */
export const JOIN_WINDOW_TAIL_MS = 15 * 60 * 1000;

export function isInJoinWindow(
  slot: { startsAt: number; endsAt: number },
  now: number,
): boolean {
  return (
    now >= slot.startsAt - JOIN_WINDOW_LEAD_MS &&
    now <= slot.endsAt + JOIN_WINDOW_TAIL_MS
  );
}
