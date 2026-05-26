import { describe, expect, it } from "vitest";
import { applyStatusSideEffects } from "../convex/taskStatusSideEffects";

const NOW = 1_000;

describe("applyStatusSideEffects", () => {
  it("syncs completed=false moving to a non-completed, non-start status (no work-period change)", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [] },
      { isCompleted: false, setsStartDate: false },
      NOW,
    );
    expect(result).toEqual({ completed: false });
    expect(result.workPeriods).toBeUndefined();
  });

  it("opens a work period entering a setsStartDate status with no open period", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [] },
      { isCompleted: false, setsStartDate: true },
      NOW,
    );
    expect(result).toEqual({
      completed: false,
      workPeriods: [{ startedAt: NOW }],
    });
  });

  it("preserves existing closed periods when opening a new one", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [{ startedAt: 100, completedAt: 200 }] },
      { isCompleted: false, setsStartDate: true },
      NOW,
    );
    expect(result.workPeriods).toEqual([
      { startedAt: 100, completedAt: 200 },
      { startedAt: NOW },
    ]);
  });

  it("does NOT open a second period when one is already open (idempotent re-entry)", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [{ startedAt: 100 }] },
      { isCompleted: false, setsStartDate: true },
      NOW,
    );
    expect(result).toEqual({ completed: false });
    expect(result.workPeriods).toBeUndefined();
  });

  it("closes the open period entering a completed status", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [{ startedAt: 100 }] },
      { isCompleted: true, setsStartDate: false },
      NOW,
    );
    expect(result).toEqual({
      completed: true,
      workPeriods: [{ startedAt: 100, completedAt: NOW }],
    });
  });

  it("closes only the open period, leaving already-closed periods intact", () => {
    const result = applyStatusSideEffects(
      {
        workPeriods: [
          { startedAt: 10, completedAt: 20 },
          { startedAt: 100 },
        ],
      },
      { isCompleted: true, setsStartDate: false },
      NOW,
    );
    expect(result.workPeriods).toEqual([
      { startedAt: 10, completedAt: 20 },
      { startedAt: 100, completedAt: NOW },
    ]);
  });

  it("completing with no open period only syncs completed (no work-period change)", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [{ startedAt: 10, completedAt: 20 }] },
      { isCompleted: true, setsStartDate: false },
      NOW,
    );
    expect(result).toEqual({ completed: true });
    expect(result.workPeriods).toBeUndefined();
  });

  it("leaves an open period untouched moving to a plain non-completed status", () => {
    const result = applyStatusSideEffects(
      { workPeriods: [{ startedAt: 100 }] },
      { isCompleted: false, setsStartDate: false },
      NOW,
    );
    expect(result).toEqual({ completed: false });
    expect(result.workPeriods).toBeUndefined();
  });

  it("setsStartDate takes precedence over completed when both set and no period is open", () => {
    // The start branch is evaluated first: a status that both starts and
    // completes (unusual but possible) opens a fresh period rather than closing.
    const result = applyStatusSideEffects(
      { workPeriods: [] },
      { isCompleted: true, setsStartDate: true },
      NOW,
    );
    expect(result).toEqual({
      completed: true,
      workPeriods: [{ startedAt: NOW }],
    });
  });

  it("treats undefined workPeriods as empty", () => {
    const result = applyStatusSideEffects(
      {},
      { isCompleted: false, setsStartDate: true },
      NOW,
    );
    expect(result.workPeriods).toEqual([{ startedAt: NOW }]);
  });
});
