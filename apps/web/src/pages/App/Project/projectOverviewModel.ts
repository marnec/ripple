import type { Id } from "@convex/_generated/dataModel";

/**
 * Everything the project overview shows about the current cycle is derived
 * here from the cycle's tasks, so the page itself only lays it out. Pure and
 * clock-injected (`now`) so it is testable without faking timers.
 */

export const DAY_MS = 86_400_000;

/** Days in progress before an open task counts as stalled. */
export const STALLED_AFTER_DAYS = 7;

/** A forecast further out than this is not a forecast, it's a stall. */
const FORECAST_HORIZON_DAYS = 365;

export type OverviewTask = {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  number?: number;
  projectKey?: string;
  priority: "urgent" | "high" | "medium" | "low";
  completed: boolean;
  statusId: Id<"taskStatuses">;
  status: { isDefault: boolean; isTriage?: boolean } | null;
  dueDate?: string;
  hasBlockers: boolean;
  assigneeId?: Id<"users">;
  assignee: { name?: string; image?: string } | null;
  externalAssignees?: unknown[];
  workPeriods?: { startedAt: number; completedAt?: number }[];
};

export type OverviewCycle = {
  _creationTime: number;
  startDate?: string;
  dueDate?: string;
};

/** Local midnight of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** An ISO `YYYY-MM-DD` date as local midnight. */
export function parseISODate(iso: string): number {
  return new Date(iso + "T00:00:00").getTime();
}

function toISODate(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** When a completed task was last completed, if the status flow recorded it. */
export function completedAt(task: OverviewTask): number | undefined {
  return task.workPeriods?.at(-1)?.completedAt;
}

/**
 * When an open task entered its current in-progress stretch, if it is in one.
 * A task sent back to the default or triage status keeps its open work
 * period, but nobody is working it — it is waiting, not in progress.
 */
export function inProgressSince(task: OverviewTask): number | undefined {
  if (!task.status || task.status.isDefault || task.status.isTriage) return undefined;
  const last = task.workPeriods?.at(-1);
  return last && last.completedAt === undefined ? last.startedAt : undefined;
}

// ── Burn-up + forecast ──────────────────────────────────────────────

export type Forecast =
  /** Every task in the cycle is done. */
  | { kind: "complete" }
  /** Nothing to forecast from yet: no completions, or the cycle just began. */
  | { kind: "unknown" }
  /** At the average pace so far, the open work lands on `finish`. */
  | { kind: "projected"; finish: number; slipDays: number | null };

export type Burnup = {
  /** First day of the x axis (local midnight). */
  start: number;
  /** Today (local midnight). */
  today: number;
  /** Target date, when the cycle has one. */
  target: number | null;
  total: number;
  /** Cumulative completed count at the end of each day, `start` … `today`. */
  series: { day: number; done: number }[];
  forecast: Forecast;
};

export function computeBurnup(
  tasks: OverviewTask[],
  cycle: OverviewCycle,
  now: number,
): Burnup {
  const today = startOfDay(now);
  const target = cycle.dueDate ? parseISODate(cycle.dueDate) : null;
  // Without a start date the axis opens on the cycle's creation day; a task
  // completed before that (and moved in later) is counted from day one.
  const start = Math.min(
    today,
    cycle.startDate ? parseISODate(cycle.startDate) : startOfDay(cycle._creationTime),
  );

  const total = tasks.length;
  // A completed task without a recorded completion time counts from day one —
  // it was done before anything here could see it.
  const doneDays = tasks
    .filter((t) => t.completed)
    .map((t) => Math.max(start, startOfDay(completedAt(t) ?? start)))
    .sort((a, b) => a - b);

  const series: Burnup["series"] = [];
  let i = 0;
  for (let day = start; day <= today; day = nextDay(day)) {
    while (i < doneDays.length && doneDays[i] <= day) i++;
    series.push({ day, done: i });
  }

  const done = doneDays.length;
  return { start, today, target, total, series, forecast: forecast(done, total, start, today, target) };
}

/** The next local midnight — not `+ DAY_MS`, which drifts across DST. */
function nextDay(day: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

function forecast(
  done: number,
  total: number,
  start: number,
  today: number,
  target: number | null,
): Forecast {
  if (total > 0 && done === total) return { kind: "complete" };
  // Today counts as an elapsed day, so a cycle in its first day has one.
  const elapsed = daysBetween(start, today) + 1;
  if (done === 0 || elapsed < 2) return { kind: "unknown" };

  const rate = done / elapsed;
  const daysLeft = Math.ceil((total - done) / rate);
  if (daysLeft > FORECAST_HORIZON_DAYS) return { kind: "unknown" };

  // Half a day of slack keeps a DST shift from landing on the previous day.
  const finish = startOfDay(today + daysLeft * DAY_MS + DAY_MS / 2);
  return {
    kind: "projected",
    finish,
    slipDays: target === null ? null : daysBetween(target, finish),
  };
}

// ── Status mix ──────────────────────────────────────────────────────

export type StatusSlice<S> = { status: S; count: number };

/** Task counts per status, in board order, dropping empty statuses. */
export function statusMix<S extends { _id: Id<"taskStatuses">; order: number }>(
  tasks: OverviewTask[],
  statuses: S[],
): StatusSlice<S>[] {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.statusId, (counts.get(t.statusId) ?? 0) + 1);
  return [...statuses]
    .sort((a, b) => a.order - b.order)
    .map((status) => ({ status, count: counts.get(status._id) ?? 0 }))
    .filter((s) => s.count > 0);
}

// ── Needs attention ─────────────────────────────────────────────────

export type SignalKey = "overdue" | "blocked" | "unowned" | "stalled";

export type Signal = { key: SignalKey; tasks: OverviewTask[] };

const URGENT = new Set(["urgent", "high"]);

/**
 * The open tasks worth a look, by reason. A task can carry several reasons;
 * it is listed under each, since each asks for a different action. Only
 * non-empty signals are returned, most pressing first.
 */
export function attentionSignals(tasks: OverviewTask[], now: number): Signal[] {
  const open = tasks.filter((t) => !t.completed);
  const todayISO = toISODate(now);
  const stalledBefore = now - STALLED_AFTER_DAYS * DAY_MS;

  const signals: Signal[] = [
    {
      key: "overdue",
      tasks: open
        .filter((t) => t.dueDate !== undefined && t.dueDate < todayISO)
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    },
    { key: "blocked", tasks: open.filter((t) => t.hasBlockers) },
    {
      key: "unowned",
      tasks: open.filter(
        (t) => URGENT.has(t.priority) && !t.assigneeId && !t.externalAssignees?.length,
      ),
    },
    {
      key: "stalled",
      tasks: open
        .filter((t) => (inProgressSince(t) ?? Infinity) < stalledBefore)
        .sort((a, b) => inProgressSince(a)! - inProgressSince(b)!),
    },
  ];
  return signals.filter((s) => s.tasks.length > 0);
}

// ── Workload ────────────────────────────────────────────────────────

export type WorkloadRow = {
  /** `null` is the unassigned bucket. */
  assigneeId: Id<"users"> | null;
  name?: string;
  image?: string;
  open: number;
  done: number;
};

/** Per-assignee open/done counts, busiest first, unassigned last. */
export function workload(tasks: OverviewTask[]): WorkloadRow[] {
  const rows = new Map<string, WorkloadRow>();
  for (const t of tasks) {
    const key = t.assigneeId ?? "";
    let row = rows.get(key);
    if (!row) {
      row = {
        assigneeId: t.assigneeId ?? null,
        name: t.assignee?.name,
        image: t.assignee?.image,
        open: 0,
        done: 0,
      };
      rows.set(key, row);
    }
    if (t.completed) row.done++;
    else row.open++;
  }
  return [...rows.values()].sort((a, b) => {
    if ((a.assigneeId === null) !== (b.assigneeId === null)) return a.assigneeId === null ? 1 : -1;
    return b.open - a.open || b.done - a.done || (a.name ?? "").localeCompare(b.name ?? "");
  });
}
