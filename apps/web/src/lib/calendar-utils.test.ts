import { describe, it, expect } from "vitest";
import { estimateToDays, isDateConflict, resolveEffectiveDueDate, computeCycleAggregates, computeHofstadterLabels } from "./calendar-utils";

describe("estimateToDays", () => {
  it("converts 8h estimate to 1 day in planned mode (multiplier=1)", () => {
    expect(estimateToDays(8, 1)).toBe(1);
  });

  it("scales by 5× in commitment mode", () => {
    expect(estimateToDays(8, 5)).toBe(5);
    expect(estimateToDays(16, 5)).toBe(10);
  });

  it("rounds fractional days up", () => {
    expect(estimateToDays(4, 1)).toBe(1);  // 0.5 → ceil → 1
    expect(estimateToDays(4, 5)).toBe(3);  // 2.5 → ceil → 3
  });

  it("returns 1 when estimate is undefined, regardless of multiplier", () => {
    expect(estimateToDays(undefined, 1)).toBe(1);
    expect(estimateToDays(undefined, 5)).toBe(1);
  });

  it("returns 1 when estimate is 0, regardless of multiplier", () => {
    expect(estimateToDays(0, 5)).toBe(1);
  });
});

describe("isDateConflict", () => {
  it("returns false when task fits within due date in planned mode", () => {
    // 8h = 1 day, start 2026-04-01, end 2026-04-01, due 2026-04-05 → no conflict
    expect(isDateConflict("2026-04-01", 8, 1, "2026-04-05")).toBe(false);
  });

  it("returns true when planned end exceeds due date", () => {
    // 40h = 5 days, start 2026-04-01, end 2026-04-05, due 2026-04-04 → conflict
    expect(isDateConflict("2026-04-01", 40, 1, "2026-04-04")).toBe(true);
  });

  it("uses multiplied end date in commitment mode", () => {
    // 8h × 5 = 40h = 5 days, start 2026-04-01, end 2026-04-05, due 2026-04-04 → conflict
    expect(isDateConflict("2026-04-01", 8, 5, "2026-04-04")).toBe(true);
  });

  it("is not a conflict when task safe in planned mode becomes safe in commitment mode too", () => {
    // 8h × 5 = 5 days, start 2026-04-01, end 2026-04-05, due 2026-04-10 → no conflict
    expect(isDateConflict("2026-04-01", 8, 5, "2026-04-10")).toBe(false);
  });

  it("no-estimate task never conflicts regardless of multiplier", () => {
    // 1 day block, start 2026-04-01, end 2026-04-01, due 2026-04-01 → equal, no conflict
    expect(isDateConflict("2026-04-01", undefined, 5, "2026-04-01")).toBe(false);
  });
});

describe("resolveEffectiveDueDate", () => {
  it("returns the task's own dueDate when set, ignoring the cycle", () => {
    expect(resolveEffectiveDueDate("2026-05-01", "2026-04-15")).toBe("2026-05-01");
  });

  it("falls back to cycle dueDate when task has no dueDate", () => {
    expect(resolveEffectiveDueDate(undefined, "2026-04-15")).toBe("2026-04-15");
  });

  it("returns undefined when neither task nor cycle has a dueDate", () => {
    expect(resolveEffectiveDueDate(undefined, undefined)).toBeUndefined();
  });
});

describe("computeCycleAggregates", () => {
  it("sums raw hours across all estimated tasks", () => {
    const result = computeCycleAggregates([{ estimate: 8 }, { estimate: 16 }]);
    expect(result.totalHours).toBe(24);
  });

  it("excludes tasks with no estimate from totalHours and counts them separately", () => {
    const result = computeCycleAggregates([{ estimate: 8 }, { estimate: undefined }, {}]);
    expect(result.totalHours).toBe(8);
    expect(result.unestimatedCount).toBe(2);
  });

  it("computes planHours as totalHours × 1.6 and commitHours as totalHours × 5", () => {
    const result = computeCycleAggregates([{ estimate: 10 }]);
    expect(result.planHours).toBe(16);
    expect(result.commitHours).toBe(50);
  });

  it("returns all zeros for an empty task list", () => {
    const result = computeCycleAggregates([]);
    expect(result).toEqual({ totalHours: 0, planHours: 0, commitHours: 0, unestimatedCount: 0 });
  });
});

describe("computeHofstadterLabels", () => {
  it("returns plan (×1.6) and commit (×5) label strings for a given estimate", () => {
    const result = computeHofstadterLabels(8);
    expect(result.plan).toBe("Plan: 12.8h");
    expect(result.commit).toBe("Commit: 40h");
  });

  it("formats fractional plan hours to one decimal place", () => {
    const result = computeHofstadterLabels(4);
    expect(result.plan).toBe("Plan: 6.4h");
    expect(result.commit).toBe("Commit: 20h");
  });

  it("omits trailing .0 for whole-number results", () => {
    const result = computeHofstadterLabels(10);
    expect(result.plan).toBe("Plan: 16h");
    expect(result.commit).toBe("Commit: 50h");
  });
});
