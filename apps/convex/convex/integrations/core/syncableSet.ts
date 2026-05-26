/**
 * Shared set-mirror logic for the syncable fields that are reconciled in BOTH
 * directions against a `string[]` mirror column on `taskIntegrationLinks`
 * (today: `externalLabels` and `externalAssigneeLogins`).
 *
 * Before this module the same concept lived in two inconsistent forms — an
 * order-insensitive boolean equality (`sameLabelSet`) on the inbound echo
 * guard, and inline `Set` add/remove diffs on the outbound dispatchers. If the
 * two ever disagreed about whether a set "changed", an outbound push could be
 * skipped (drift) or an inbound bounce-back could slip past the echo guard
 * (loop). Routing both through `diffSet` makes them provably consistent.
 *
 * It also fixes a latent casing divergence: inbound lowercased assignee logins
 * while outbound mirrored them as-stored, so a non-lowercase identity login
 * made the two sides compare unequal and bounce. `normalizeLoginList` gives
 * both directions one canonical form. Pure (no Convex imports) so it is
 * trivially unit-testable.
 */

export interface SetDiff {
  /** Members in `next` not in `prev`. */
  add: string[];
  /** Members in `prev` not in `next`. */
  remove: string[];
  /**
   * Whether the sets differ. `prev === undefined` ("never synced") always
   * counts as changed so a first reconciliation applies even when both sides
   * are empty — matching the legacy inbound echo guard. Outbound callers that
   * want empty-vs-empty to be a no-op pass `prev ?? []` instead of `undefined`.
   */
  changed: boolean;
}

/** Order-insensitive diff of two pre-normalized string sets. */
export function diffSet(
  next: readonly string[],
  prev: readonly string[] | undefined,
): SetDiff {
  const prevList = prev ?? [];
  const prevSet = new Set(prevList);
  const nextSet = new Set(next);
  const add = next.filter((x) => !prevSet.has(x));
  const remove = prevList.filter((x) => !nextSet.has(x));
  const changed = prev === undefined || add.length > 0 || remove.length > 0;
  return { add, remove, changed };
}

/**
 * Canonical form for a GitHub login set: trimmed, lowercased, deduped,
 * first-occurrence order preserved. GitHub logins are case-insensitive, so
 * lowercasing is safe for the assignee API and makes the inbound mirror equal
 * the outbound mirror.
 */
export function normalizeLoginList(logins: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of logins) {
    const login = raw.trim().toLowerCase();
    if (login.length === 0 || seen.has(login)) continue;
    seen.add(login);
    out.push(login);
  }
  return out;
}
