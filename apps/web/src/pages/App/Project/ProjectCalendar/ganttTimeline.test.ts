import { describe, it, expect } from "vitest";
import { Temporal } from "temporal-polyfill";
import { addCalendarDays } from "@/lib/calendar-utils";
import {
  taskSpan,
  computeRange,
  dateFromOffset,
  pageScrollPlan,
  isCellWidthStretched,
  svarCellWidth,
} from "./ganttTimeline";
import type { EnrichedTask } from "./calendar-events";

// Minimal EnrichedTask factory — only the fields the geometry reads.
function task(id: string, plannedStartDate: string, estimate?: number): EnrichedTask {
  return {
    _id: id,
    title: id,
    statusId: "s",
    priority: "medium",
    completed: false,
    plannedStartDate,
    estimate,
    status: null,
  };
}

describe("taskSpan", () => {
  it("returns null for an empty list", () => {
    expect(taskSpan([], 1)).toBeNull();
  });

  it("spans a single task from start to start+estimateToDays", () => {
    // 8h @ 1× = 1 day → end = start + 1
    expect(taskSpan([task("a", "2026-06-10", 8)], 1)).toEqual({
      minISO: "2026-06-10",
      maxISO: "2026-06-11",
    });
  });

  it("takes the earliest start and the latest end across tasks", () => {
    const span = taskSpan(
      [task("a", "2026-06-10", 8), task("b", "2026-06-05", 8), task("c", "2026-06-20", 40)],
      1,
    );
    // c: 40h @ 1× = 5 days → end 2026-06-25 is the latest
    expect(span).toEqual({ minISO: "2026-06-05", maxISO: "2026-06-25" });
  });

  it("scales the end by the commitment multiplier", () => {
    // 8h @ 5× = 5 days → end = start + 5
    expect(taskSpan([task("a", "2026-06-10", 8)], 5)).toEqual({
      minISO: "2026-06-10",
      maxISO: "2026-06-15",
    });
  });
});

describe("computeRange", () => {
  const base = { resolution: "Day" as const, containerWidth: 0, panDays: { past: 0, future: 0 } };

  it("centres on today with -14/+30 padding when there are no tasks", () => {
    expect(computeRange(null, { ...base, todayISO: "2026-06-01" })).toEqual({
      startISO: "2026-05-18",
      endISO: "2026-07-01",
    });
  });

  it("always contains today even when the task span is later", () => {
    const span = { minISO: "2026-08-01", maxISO: "2026-08-05" };
    const { startISO } = computeRange(span, { ...base, todayISO: "2026-06-01" });
    // start is padded from today (the earlier of the two), not from the span
    expect(startISO).toBe("2026-05-18");
  });

  it("pads from the task span when it is wider than today", () => {
    const span = { minISO: "2026-03-01", maxISO: "2026-03-10" };
    expect(computeRange(span, { ...base, todayISO: "2026-06-01" })).toEqual({
      startISO: addCalendarDays("2026-03-01", -14),
      endISO: addCalendarDays("2026-06-01", 30), // today is the later edge here
    });
  });

  it("snaps the start to a Sunday in Week resolution", () => {
    const { startISO } = computeRange(null, {
      ...base,
      resolution: "Week",
      todayISO: "2026-06-03", // arbitrary midweek date
    });
    expect(Temporal.PlainDate.from(startISO).dayOfWeek).toBe(7); // ISO Sunday
  });

  it("extends the end to fill a wide container (anti cellWidth-stretch)", () => {
    const todayISO = "2026-06-01";
    const narrow = computeRange(null, { ...base, todayISO, containerWidth: 0 });
    const wide = computeRange(null, { ...base, todayISO, containerWidth: 4200 });
    expect(wide.endISO > narrow.endISO).toBe(true);
    // start is unaffected by the fill
    expect(wide.startISO).toBe(narrow.startISO);
  });

  it("does not apply the fill when containerWidth is 0 (SSR seed)", () => {
    const r = computeRange(null, { ...base, todayISO: "2026-06-01", containerWidth: 0 });
    expect(r.endISO).toBe("2026-07-01"); // natural +30 only
  });

  it("grows the past side by panDays.past", () => {
    const todayISO = "2026-06-01";
    const r0 = computeRange(null, { ...base, todayISO });
    const r7 = computeRange(null, { ...base, todayISO, panDays: { past: 7, future: 0 } });
    expect(r7.startISO).toBe(addCalendarDays(r0.startISO, -7));
    expect(r7.endISO).toBe(r0.endISO);
  });

  it("grows the future side by panDays.future", () => {
    const todayISO = "2026-06-01";
    const r0 = computeRange(null, { ...base, todayISO });
    const r7 = computeRange(null, { ...base, todayISO, panDays: { past: 0, future: 7 } });
    expect(r7.endISO).toBe(addCalendarDays(r0.endISO, 7));
    expect(r7.startISO).toBe(r0.startISO);
  });
});

describe("dateFromOffset", () => {
  const dayScale = { startISO: "2026-06-01", lengthUnitWidth: 42, lengthUnit: "day" };

  it("maps the origin to the scale's start date", () => {
    expect(dateFromOffset(100, 100, dayScale)).toBe("2026-06-01");
  });

  it("advances one day per unit width in Day resolution", () => {
    expect(dateFromOffset(100 + 42, 100, dayScale)).toBe("2026-06-02");
    expect(dateFromOffset(100 + 42 * 3, 100, dayScale)).toBe("2026-06-04");
  });

  it("advances 7 days per week unit", () => {
    const wk = { startISO: "2026-06-07", lengthUnitWidth: 80, lengthUnit: "week" };
    expect(dateFromOffset(80, 0, wk)).toBe("2026-06-14");
  });

  it("advances 30 days per month unit", () => {
    const mo = { startISO: "2026-06-01", lengthUnit: "month", lengthUnitWidth: 120 };
    expect(dateFromOffset(120, 0, mo)).toBe(addCalendarDays("2026-06-01", 30));
  });

  it("clamps a cursor left of the origin to the start date", () => {
    expect(dateFromOffset(40, 100, dayScale)).toBe("2026-06-01");
  });
});

describe("pageScrollPlan", () => {
  // Day: pageWidth = 42 * 7 = 294, pageDays = 7
  it("scrolls within range when the page stays in bounds", () => {
    const plan = pageScrollPlan({ scrollLeft: 0, scalesWidth: 1000, chartWidth: 300 }, 1, "Day");
    expect(plan).toEqual({ kind: "within", left: 294 });
  });

  it("clamps an in-range forward page to maxScroll", () => {
    // maxScroll = 1000 - 800 = 200; target 294 > 200 but <= maxScroll? no, > → grow.
    // Use a case where target <= maxScroll but min() still clamps a near-edge page.
    const plan = pageScrollPlan({ scrollLeft: 0, scalesWidth: 1000, chartWidth: 700 }, 1, "Day");
    expect(plan).toEqual({ kind: "within", left: 294 }); // maxScroll 300, 294 < 300
  });

  it("grows the future side when paging past the right edge", () => {
    const plan = pageScrollPlan({ scrollLeft: 650, scalesWidth: 1000, chartWidth: 300 }, 1, "Day");
    // maxScroll = 700; target = 944 > 700 → grow future
    expect(plan).toEqual({ kind: "grow", side: "future", pageDays: 7, anchor: 650, target: 944 });
  });

  it("grows the past side when paging before the left edge", () => {
    const plan = pageScrollPlan({ scrollLeft: 100, scalesWidth: 1000, chartWidth: 300 }, -1, "Day");
    // target = 100 - 294 = -194 < 0 → grow past; anchor = 100 + 294 = 394
    expect(plan).toEqual({ kind: "grow", side: "past", pageDays: 7, anchor: 394, target: 100 });
  });

  it("scrolls within range backward when not past the left edge", () => {
    const plan = pageScrollPlan({ scrollLeft: 400, scalesWidth: 1000, chartWidth: 300 }, -1, "Day");
    expect(plan).toEqual({ kind: "within", left: 106 }); // 400 - 294
  });
});

describe("isCellWidthStretched", () => {
  it("is false at the exact expected width", () => {
    expect(isCellWidthStretched(svarCellWidth("Day"), "Day")).toBe(false);
    expect(isCellWidthStretched(svarCellWidth("Week"), "Week")).toBe(false);
  });

  it("tolerates sub-1% drift", () => {
    expect(isCellWidthStretched(42.3, "Day")).toBe(false); // 0.3/42 ≈ 0.7%
  });

  it("flags a stretch beyond 1%", () => {
    expect(isCellWidthStretched(43, "Day")).toBe(true); // 1/42 ≈ 2.4%
    expect(isCellWidthStretched(13, "Week")).toBe(true); // expected ≈ 11.43
  });
});
