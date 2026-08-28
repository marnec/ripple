import { describe, it, expect } from "vitest";
import { Temporal } from "temporal-polyfill";
import { actualSpan, formatActualSpan, isTaskInMonth, spanInMonth } from "./calendar-events";
import type { EnrichedTask } from "./calendar-events";

// Minimal EnrichedTask factory — only the fields the month scoping reads.
function task(plannedStartDate?: string, estimate?: number): EnrichedTask {
  return {
    _id: "t",
    title: "t",
    statusId: "s",
    priority: "medium",
    completed: false,
    plannedStartDate,
    estimate,
    status: null,
  };
}

const AUG = { year: 2026, month: 8 };

describe("isTaskInMonth", () => {
  it("excludes an unscheduled task", () => {
    expect(isTaskInMonth(task(undefined), AUG)).toBe(false);
  });

  it("includes a task starting inside the month", () => {
    expect(isTaskInMonth(task("2026-08-14"), AUG)).toBe(true);
  });

  it("includes the first and last day of the month", () => {
    expect(isTaskInMonth(task("2026-08-01"), AUG)).toBe(true);
    expect(isTaskInMonth(task("2026-08-31"), AUG)).toBe(true);
  });

  it("excludes the days either side of the month", () => {
    expect(isTaskInMonth(task("2026-07-31"), AUG)).toBe(false);
    expect(isTaskInMonth(task("2026-09-01"), AUG)).toBe(false);
  });

  // The grid draws a task across its whole estimated span, so the sidebar has
  // to count a task that merely *reaches* the month as in it.
  it("includes a task that starts before the month but runs into it", () => {
    // 40h ≈ 5 days: Jul 29 → Aug 2.
    expect(isTaskInMonth(task("2026-07-29", 40), AUG)).toBe(true);
  });

  it("excludes a task whose span still ends before the month", () => {
    // 8h = 1 day: Jul 29 only.
    expect(isTaskInMonth(task("2026-07-29", 8), AUG)).toBe(false);
  });

  it("stretches the span in commitment mode, matching buildTaskEvents", () => {
    // 8h × 5 = 5 days: Jul 29 → Aug 2 with the multiplier, Jul 29 without.
    expect(isTaskInMonth(task("2026-07-29", 8), AUG, 5)).toBe(true);
    expect(isTaskInMonth(task("2026-07-29", 8), AUG, 1)).toBe(false);
  });

  it("handles a December → January boundary", () => {
    expect(isTaskInMonth(task("2025-12-30", 40), { year: 2026, month: 1 })).toBe(true);
    expect(isTaskInMonth(task("2025-12-30", 40), { year: 2025, month: 1 })).toBe(false);
  });
});

// Local noon, so the UTC↔local conversion inside `actualSpan` can never tip a
// fixture onto the neighbouring date wherever the suite runs.
function noon(isoDate: string): number {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return Temporal.PlainDateTime.from(`${isoDate}T12:00`).toZonedDateTime(tz).epochMilliseconds;
}

function withPeriods(periods: { startedAt: number; completedAt?: number }[]): EnrichedTask {
  return { ...task("2026-08-10"), workPeriods: periods };
}

describe("actualSpan", () => {
  it("is null with no work periods at all", () => {
    expect(actualSpan(task("2026-08-10"))).toBeNull();
  });

  it("is null when every period is still open", () => {
    expect(actualSpan(withPeriods([{ startedAt: noon("2026-05-26") }]))).toBeNull();
  });

  it("envelopes every completed period, ignoring open ones", () => {
    expect(
      actualSpan(
        withPeriods([
          { startedAt: noon("2026-04-29"), completedAt: noon("2026-05-22") },
          { startedAt: noon("2026-05-26") },
        ]),
      ),
    ).toEqual({ start: "2026-04-29", end: "2026-05-22" });
  });

  // The case that made the toggle look broken: logged time months away from
  // the planned date, so the overlay lands outside the month on screen.
  it("is unrelated to plannedStartDate", () => {
    const t = withPeriods([{ startedAt: noon("2026-04-29"), completedAt: noon("2026-05-22") }]);
    expect(t.plannedStartDate).toBe("2026-08-10");
    expect(spanInMonth(actualSpan(t)!.start, actualSpan(t)!.end, AUG)).toBe(false);
  });
});

describe("formatActualSpan", () => {
  it("collapses a single-day span", () => {
    expect(formatActualSpan({ start: "2026-04-29", end: "2026-04-29" })).toBe("Apr 29");
  });

  it("renders a multi-day span as a range", () => {
    expect(formatActualSpan({ start: "2026-04-29", end: "2026-05-22" })).toBe("Apr 29 – May 22");
  });
});
