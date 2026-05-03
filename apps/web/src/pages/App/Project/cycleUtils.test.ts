import { describe, it, expect, vi, afterEach } from "vitest";
import { daysRemaining, formatDateRange, CYCLE_STATUS_STYLES } from "./cycleUtils";

describe("daysRemaining", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no dueDate", () => {
    expect(daysRemaining(undefined)).toBeNull();
  });

  it("returns 0 when dueDate is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00"));
    expect(daysRemaining("2026-03-04")).toBe(0);
  });

  it("returns positive number for future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00"));
    expect(daysRemaining("2026-03-14")).toBe(10);
  });

  it("returns negative number for past dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00"));
    expect(daysRemaining("2026-03-01")).toBe(-3);
  });
});

describe("formatDateRange", () => {
  it("formats both dates", () => {
    const result = formatDateRange("2026-03-01", "2026-03-31");
    expect(result).toContain("Mar");
  });

  it("formats start-only with 'from' prefix", () => {
    const result = formatDateRange("2026-03-01", undefined);
    expect(result).toMatch(/^from /);
  });

  it("formats end-only with 'until' prefix", () => {
    const result = formatDateRange(undefined, "2026-03-31");
    expect(result).toMatch(/^until /);
  });

  it("returns empty string for no dates", () => {
    expect(formatDateRange(undefined, undefined)).toBe("");
  });
});

describe("CYCLE_STATUS_STYLES", () => {
  it("has styles for all four statuses", () => {
    expect(Object.keys(CYCLE_STATUS_STYLES)).toEqual([
      "draft",
      "upcoming",
      "active",
      "completed",
    ]);
  });
});
