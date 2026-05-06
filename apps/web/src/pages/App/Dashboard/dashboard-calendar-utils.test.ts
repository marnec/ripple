import { describe, expect, it } from "vitest";
import {
  fromLocalDateTimeInput,
  joinWindowStatus,
  parseEmailChips,
  toLocalDateTimeInput,
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

describe("local datetime round-trip", () => {
  it("toLocalDateTimeInput → fromLocalDateTimeInput preserves wall-clock minute", () => {
    const ms = new Date(2026, 4, 15, 14, 30).getTime(); // local 14:30
    const s = toLocalDateTimeInput(ms);
    expect(s).toBe("2026-05-15T14:30");
    const back = fromLocalDateTimeInput(s);
    expect(back).toBe(ms);
  });
});
