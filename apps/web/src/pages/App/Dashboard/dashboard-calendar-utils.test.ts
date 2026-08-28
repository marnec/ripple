import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  formatCalendarRangeLabels,
  joinWindowStatus,
  parseEmailChips,
} from "./dashboard-calendar-utils";

describe("joinWindowStatus", () => {
  const start = 1_700_000_000_000;
  const end = start + 60 * 60 * 1000;

  it("returns 'pending' more than 5 minutes before start", () => {
    expect(joinWindowStatus(start, end, start - 6 * 60 * 1000)).toBe("pending");
  });

  it("returns 'open' inside the lead window", () => {
    expect(joinWindowStatus(start, end, start - 4 * 60 * 1000)).toBe("open");
    expect(joinWindowStatus(start, end, start)).toBe("open");
    expect(joinWindowStatus(start, end, end + 10 * 60 * 1000)).toBe("open");
  });

  it("returns 'ended' after the tail window", () => {
    expect(joinWindowStatus(start, end, end + 16 * 60 * 1000)).toBe("ended");
  });
});

describe("parseEmailChips", () => {
  it("normalises and dedupes valid emails", () => {
    const r = parseEmailChips("Alice@Test.com, bob@test.com  alice@test.com");
    expect(r.valid).toEqual(["alice@test.com", "bob@test.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("captures invalid tokens separately", () => {
    const r = parseEmailChips("ok@x.com, not-an-email, also-bad");
    expect(r.valid).toEqual(["ok@x.com"]);
    expect(r.invalid).toEqual(["not-an-email", "also-bad"]);
  });

  it("handles empty / whitespace-only input", () => {
    const r = parseEmailChips("  \n  ");
    expect(r.valid).toEqual([]);
    expect(r.invalid).toEqual([]);
  });
});


describe("formatCalendarRangeLabels", () => {
  const d = (iso: string) => Temporal.PlainDate.from(iso);

  it("returns empty labels before the calendar mounts", () => {
    expect(formatCalendarRangeLabels(null, false)).toEqual({
      full: "",
      compact: "",
    });
  });

  it("labels a month view with month + year in both forms", () => {
    expect(formatCalendarRangeLabels(d("2026-05-14"), true)).toEqual({
      full: "May 2026",
      compact: "May 2026",
    });
  });

  it("labels a week inside one month without repeating the month", () => {
    // Mon 2026-05-04 … Sun 2026-05-10
    expect(formatCalendarRangeLabels(d("2026-05-06"), false).full).toBe(
      "May 4 – 10, 2026",
    );
  });

  it("spells out both months when the week crosses a month boundary", () => {
    // Mon 2026-04-27 … Sun 2026-05-03
    expect(formatCalendarRangeLabels(d("2026-04-29"), false).full).toBe(
      "Apr 27 – May 3, 2026",
    );
  });

  it("spells out both years when the week crosses new year", () => {
    // Mon 2025-12-29 … Sun 2026-01-04
    expect(formatCalendarRangeLabels(d("2025-12-31"), false).full).toBe(
      "Dec 29, 2025 – Jan 4, 2026",
    );
  });

  it("uses the week's centre day for the compact label so a straddling week doesn't mislead", () => {
    // Mon 2026-04-27 … Sun 2026-05-03 — Thursday falls in April.
    expect(formatCalendarRangeLabels(d("2026-04-29"), false).compact).toBe(
      "April 2026",
    );
    // Mon 2026-08-31 … Sun 2026-09-06 — Thursday falls in September.
    expect(formatCalendarRangeLabels(d("2026-08-31"), false).compact).toBe(
      "September 2026",
    );
  });

  it("derives the week from any day in it, not just the anchor", () => {
    const mon = formatCalendarRangeLabels(d("2026-05-04"), false);
    const sun = formatCalendarRangeLabels(d("2026-05-10"), false);
    expect(sun).toEqual(mon);
  });
});
