import type { Doc } from "./_generated/dataModel";

export interface WorkPeriod {
  startedAt: number;
  completedAt?: number;
}

/**
 * Canonical side-effects of moving a task into `newStatus`.
 *
 * Pure: returns the patch fragment to merge into the caller's
 * `ctx.db.patch` / `ctx.db.insert`. Every site that changes a task's status —
 * manual update, kanban drag, PR-branch automation, inbound GitHub
 * close/reopen, status-delete reassignment — must apply these so `completed`
 * and work-period tracking stay consistent no matter which path drove the
 * transition. (Before this was extracted, the inbound sync and status-delete
 * paths synced `completed` but silently skipped work periods.)
 *
 *  - `completed` always mirrors the destination status.
 *  - Entering a `setsStartDate` status with no open period opens one.
 *  - Entering a completed status closes the open period, if any.
 *
 * The two work-period branches are mutually exclusive; when neither fires the
 * fragment omits `workPeriods` entirely so the caller leaves it untouched.
 * `now` is injectable for deterministic tests; callers pass nothing.
 */
export function applyStatusSideEffects(
  task: Pick<Doc<"tasks">, "workPeriods">,
  newStatus: Pick<Doc<"taskStatuses">, "isCompleted" | "setsStartDate">,
  now: number = Date.now(),
): { completed: boolean; workPeriods?: WorkPeriod[] } {
  const periods = task.workPeriods ?? [];
  const openPeriod = periods.find((p) => p.completedAt === undefined);

  const fragment: { completed: boolean; workPeriods?: WorkPeriod[] } = {
    completed: newStatus.isCompleted,
  };

  if (newStatus.setsStartDate && !openPeriod) {
    fragment.workPeriods = [...periods, { startedAt: now }];
  } else if (newStatus.isCompleted && openPeriod) {
    fragment.workPeriods = periods.map((p) =>
      p.completedAt === undefined ? { ...p, completedAt: now } : p,
    );
  }

  return fragment;
}
