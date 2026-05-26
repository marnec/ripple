const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * True when an entitlement-frozen link has been frozen for at least 24 h.
 * Drives the "Force resync after restoring entitlement" banner per the
 * GitHub-integration PRD's freeze recovery flow.
 *
 * `frozenAt` may be absent on links frozen before this column existed —
 * treated as "freeze duration unknown" → no banner. The banner is a
 * suggestion; the absence of one for ancient legacy freezes is harmless.
 */
export function isFrozenOver24h(
  link: { pausedByBilling: boolean; frozenAt?: number },
  now: number,
): boolean {
  if (!link.pausedByBilling) return false;
  if (link.frozenAt === undefined) return false;
  return now - link.frozenAt >= TWENTY_FOUR_HOURS_MS;
}

/**
 * Compact relative time for the "Last webhook received" indicator. Coarse
 * buckets (just now / m / h / d) — the admin only needs to know whether the
 * integration is receiving events, not the exact second.
 */
export function formatLastWebhook(ts: number | undefined, now: number): string {
  if (ts === undefined) return "Never";
  const delta = now - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (delta < min) return "just now";
  if (delta < hour) return `${Math.floor(delta / min)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  return `${Math.floor(delta / day)}d ago`;
}
