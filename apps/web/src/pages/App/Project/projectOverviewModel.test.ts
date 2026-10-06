import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  DAY_MS,
  attentionSignals,
  computeBurnup,
  parseISODate,
  statusMix,
  workload,
  type OverviewTask,
} from "./projectOverviewModel";

const todo = "todo" as Id<"taskStatuses">;
const doing = "doing" as Id<"taskStatuses">;
const done = "done" as Id<"taskStatuses">;

let seq = 0;
function task(over: Partial<OverviewTask> = {}): OverviewTask {
  seq++;
  return {
    _id: `t${seq}` as Id<"tasks">,
    _creationTime: 0,
    title: `Task ${seq}`,
    priority: "medium",
    completed: false,
    statusId: todo,
    status: { isDefault: true },
    hasBlockers: false,
    assignee: null,
    ...over,
  };
}

/** Noon on an ISO day, so day arithmetic is never on a midnight edge. */
const noon = (iso: string) => parseISODate(iso) + DAY_MS / 2;

function doneOn(iso: string, over: Partial<OverviewTask> = {}) {
  return task({
    completed: true,
    statusId: done,
    status: { isDefault: false },
    workPeriods: [{ startedAt: noon(iso) - DAY_MS, completedAt: noon(iso) }],
    ...over,
  });
}

describe("computeBurnup", () => {
  const cycle = { _creationTime: noon("2026-10-01"), startDate: "2026-10-01", dueDate: "2026-10-10" };

  it("accumulates completions per day from the start to today", () => {
    const b = computeBurnup(
      [doneOn("2026-10-02"), doneOn("2026-10-02"), doneOn("2026-10-04"), task()],
      cycle,
      noon("2026-10-04"),
    );
    expect(b.total).toBe(4);
    expect(b.series.map((p) => p.done)).toEqual([0, 2, 2, 3]);
    expect(b.series[0].day).toBe(parseISODate("2026-10-01"));
    expect(b.target).toBe(parseISODate("2026-10-10"));
  });

  it("counts completions before the start, or without a timestamp, from day one", () => {
    const b = computeBurnup(
      [doneOn("2026-09-20"), task({ completed: true, statusId: done })],
      cycle,
      noon("2026-10-02"),
    );
    expect(b.series.map((p) => p.done)).toEqual([2, 2]);
  });

  it("opens the axis on the creation day when the cycle has no start date", () => {
    const b = computeBurnup([], { _creationTime: noon("2026-10-03") }, noon("2026-10-05"));
    expect(b.series).toHaveLength(3);
    expect(b.target).toBeNull();
  });

  it("projects the finish from the average pace and reports the slip", () => {
    // 4 days elapsed (1st–4th), 2 done → 0.5/day; 2 left → 4 more days → the 8th.
    const b = computeBurnup(
      [doneOn("2026-10-02"), doneOn("2026-10-03"), task(), task()],
      cycle,
      noon("2026-10-04"),
    );
    expect(b.forecast).toEqual({
      kind: "projected",
      finish: parseISODate("2026-10-08"),
      slipDays: -2,
    });
  });

  it("reports a slip past the target as positive days", () => {
    // 4 days, 1 done → 0.25/day; 3 left → 12 days → the 16th, 6 past the 10th.
    const b = computeBurnup([doneOn("2026-10-02"), task(), task(), task()], cycle, noon("2026-10-04"));
    expect(b.forecast).toMatchObject({ kind: "projected", slipDays: 6 });
  });

  it("does not forecast without completions, on day one, or when finished", () => {
    expect(computeBurnup([task()], cycle, noon("2026-10-04")).forecast.kind).toBe("unknown");
    expect(computeBurnup([doneOn("2026-10-01"), task()], cycle, noon("2026-10-01")).forecast.kind).toBe("unknown");
    expect(computeBurnup([doneOn("2026-10-02")], cycle, noon("2026-10-04")).forecast.kind).toBe("complete");
  });

  it("gives up on a forecast more than a year out", () => {
    const tasks = [doneOn("2026-10-02"), ...Array.from({ length: 400 }, () => task())];
    expect(computeBurnup(tasks, cycle, noon("2026-10-04")).forecast.kind).toBe("unknown");
  });
});

describe("statusMix", () => {
  it("counts per status in board order and drops empty statuses", () => {
    const statuses = [
      { _id: done, order: 2 },
      { _id: todo, order: 0 },
      { _id: doing, order: 1 },
    ];
    const mix = statusMix([task(), task(), task({ statusId: done })], statuses);
    expect(mix.map((s) => [s.status._id, s.count])).toEqual([
      [todo, 2],
      [done, 1],
    ]);
  });
});

describe("attentionSignals", () => {
  const now = noon("2026-10-10");
  const user = "u1" as Id<"users">;

  it("flags overdue, blocked, unowned urgent and stalled open tasks", () => {
    const overdue = task({ dueDate: "2026-10-09" });
    const dueToday = task({ dueDate: "2026-10-10" });
    const blocked = task({ hasBlockers: true });
    const unowned = task({ priority: "urgent" });
    const ownedUrgent = task({ priority: "high", assigneeId: user });
    const externallyOwned = task({ priority: "high", externalAssignees: [{}] });
    const inDev = { statusId: doing, status: { isDefault: false } };
    const stalled = task({ ...inDev, workPeriods: [{ startedAt: now - 8 * DAY_MS }] });
    const fresh = task({ ...inDev, workPeriods: [{ startedAt: now - 2 * DAY_MS }] });
    // Sent back to the default status: still has an open work period, not stalled.
    const sentBack = task({ workPeriods: [{ startedAt: now - 30 * DAY_MS }] });
    const closedOverdue = doneOn("2026-10-05", { dueDate: "2026-10-01" });

    const signals = attentionSignals(
      [overdue, dueToday, blocked, unowned, ownedUrgent, externallyOwned, stalled, fresh, sentBack, closedOverdue],
      now,
    );
    expect(Object.fromEntries(signals.map((s) => [s.key, s.tasks.map((t) => t._id)]))).toEqual({
      overdue: [overdue._id],
      blocked: [blocked._id],
      unowned: [unowned._id],
      stalled: [stalled._id],
    });
  });

  it("returns nothing when all is well", () => {
    expect(attentionSignals([task(), doneOn("2026-10-01")], now)).toEqual([]);
  });

  it("orders overdue by due date and stalled by how long they sat", () => {
    const later = task({ dueDate: "2026-10-08" });
    const earlier = task({ dueDate: "2026-10-01" });
    const inDev = { statusId: doing, status: { isDefault: false } };
    const newer = task({ ...inDev, workPeriods: [{ startedAt: now - 9 * DAY_MS }] });
    const older = task({ ...inDev, workPeriods: [{ startedAt: now - 20 * DAY_MS }] });
    const signals = attentionSignals([later, earlier, newer, older], now);
    expect(signals.find((s) => s.key === "overdue")!.tasks).toEqual([earlier, later]);
    expect(signals.find((s) => s.key === "stalled")!.tasks).toEqual([older, newer]);
  });
});

describe("workload", () => {
  it("groups by assignee, busiest first, unassigned last", () => {
    const ada = "ada" as Id<"users">;
    const bob = "bob" as Id<"users">;
    const rows = workload([
      task(),
      task({ assigneeId: ada, assignee: { name: "Ada" } }),
      task({ assigneeId: bob, assignee: { name: "Bob" } }),
      task({ assigneeId: bob, assignee: { name: "Bob" } }),
      doneOn("2026-10-01", { assigneeId: ada, assignee: { name: "Ada" } }),
    ]);
    expect(rows.map((r) => [r.assigneeId, r.open, r.done])).toEqual([
      [bob, 2, 0],
      [ada, 1, 1],
      [null, 1, 0],
    ]);
  });
});
