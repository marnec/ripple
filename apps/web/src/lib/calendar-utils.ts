import { Temporal } from "temporal-polyfill";

/**
 * Convert an estimate (hours) to calendar days, scaled by a commitment multiplier.
 * No estimate → always 1 day (unaffected by multiplier).
 */
export function estimateToDays(estimate: number | undefined, multiplier: 1 | 5 = 1): number {
  if (!estimate || estimate <= 0) return 1;
  return Math.max(1, Math.ceil((estimate * multiplier) / 8));
}

/**
 * Add N calendar days to an ISO date string.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  if (days === 0) return isoDate;
  return Temporal.PlainDate.from(isoDate).add({ days }).toString();
}

/**
 * Returns the effective due date for conflict detection.
 * A task's own dueDate always wins; falls back to the cycle's dueDate.
 */
export function resolveEffectiveDueDate(
  taskDueDate: string | undefined,
  cycleDueDate: string | undefined,
): string | undefined {
  return taskDueDate ?? cycleDueDate;
}

/**
 * Hofstadter aggregates for a cycle's task list.
 * Tasks without an estimate are excluded from the hour totals.
 */
export function computeCycleAggregates(tasks: Array<{ estimate?: number }>): {
  totalHours: number;
  planHours: number;
  commitHours: number;
  unestimatedCount: number;
} {
  let totalHours = 0;
  let unestimatedCount = 0;
  for (const t of tasks) {
    if (t.estimate && t.estimate > 0) {
      totalHours += t.estimate;
    } else {
      unestimatedCount++;
    }
  }
  return {
    totalHours,
    planHours: totalHours * 1.6,
    commitHours: totalHours * 5,
    unestimatedCount,
  };
}

/**
 * Hofstadter multiplier labels for display adjacent to the estimate field.
 * Plan = estimate × 1.6, Commit = estimate × 5.
 * Trailing ".0" is omitted; one decimal place otherwise.
 */
export function computeHofstadterLabels(estimate: number): { plan: string; commit: string } {
  const fmt = (h: number) => {
    const rounded = Math.round(h * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
  };
  return {
    plan: `Plan: ${fmt(estimate * 1.6)}`,
    commit: `Commit: ${fmt(estimate * 5)}`,
  };
}

/**
 * Returns true when the planned end date exceeds the due date.
 * plannedEndDate = plannedStartDate + estimateToDays(estimate, multiplier) - 1
 */
export function isDateConflict(
  plannedStartDate: string,
  estimate: number | undefined,
  multiplier: 1 | 5,
  dueDate: string,
): boolean {
  const days = estimateToDays(estimate, multiplier);
  const plannedEnd = addCalendarDays(plannedStartDate, days - 1);
  return plannedEnd > dueDate;
}
