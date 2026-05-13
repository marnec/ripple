// Color helpers for the dashboard's member-calendar overlay. Lives in
// its own module (not co-located with `MemberCalendarFilter.tsx`) so the
// React Fast Refresh contract — "files that export components export
// only components" — stays intact. The combobox component imports these
// for the per-member swatch dot, and `MyCalendarTab.tsx` imports them
// for the schedule-x background-event styles.

/**
 * Deterministic hue (0–359) from a userId. djb2-ish multiplier-31 hash —
 * cheap, good enough spread for the ~tens-of-members case the dashboard
 * filter is sized for. Stable across reloads so the same colleague
 * keeps their colour every session, which is the only reason this isn't
 * a random palette index.
 */
export function memberHueFor(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/**
 * Schedule-x BackgroundEvent style for a member's busy block. Mid
 * saturation/lightness so the tint stays readable in both light and
 * dark theme; the light-alpha background lets adjacent foreground
 * events remain visible through overlapping blocks.
 *
 * Return type is a plain string-keyed record because schedule-x's
 * `BackgroundEvent.style` is typed against preact's `CSSProperties` (an
 * index signature `[k: string]: string | number`), not React's. Mixing
 * the two errors at the BackgroundEvent assignment site.
 */
export function memberBlockStyle(userId: string): Record<string, string> {
  const hue = memberHueFor(userId);
  // `--sx-bg-event-opacity` is read by the dim + fade-in pair in
  // project-calendar.css — see comment on buildCycleBackgroundEvents in
  // ProjectCalendar.tsx for why this isn't `opacity: "0.75"` anymore.
  return {
    background: `hsl(${hue} 70% 55% / 0.18)`,
    borderLeft: `2px solid hsl(${hue} 70% 50% / 0.85)`,
    "--sx-bg-event-opacity": "0.75",
  };
}
