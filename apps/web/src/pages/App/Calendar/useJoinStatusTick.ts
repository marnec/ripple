import { useEffect, useState } from "react";

/**
 * Returns a value of `Date.now()` that re-renders the caller every
 * 30 seconds. Used by the event-detail surfaces (sheet, page, guest
 * landing) so the Join-call button transitions from "pending" → "open"
 * → "ended" without a manual refresh, even when the user leaves the
 * tab open across the join-window boundary.
 *
 * The 30s cadence matches the join-window lead/tail margin (5 min /
 * 15 min) — coarser than the visible state changes by an order of
 * magnitude, so users see the transition within at most one tick.
 */
export function useJoinStatusTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
