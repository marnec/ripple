import { describe, expect, it } from "vitest";
import { isFrozenOver24h } from "./integration-utils";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("isFrozenOver24h", () => {
  it("returns false when the link is not frozen", () => {
    const now = 1_700_000_000_000;
    expect(
      isFrozenOver24h({ pausedByBilling: false, frozenAt: undefined }, now),
    ).toBe(false);
  });

  it("returns false when frozen less than 24 hours ago", () => {
    const now = 1_700_000_000_000;
    expect(
      isFrozenOver24h(
        { pausedByBilling: true, frozenAt: now - 23 * HOUR },
        now,
      ),
    ).toBe(false);
  });

  it("returns true when frozen exactly 24 hours ago", () => {
    const now = 1_700_000_000_000;
    expect(
      isFrozenOver24h({ pausedByBilling: true, frozenAt: now - DAY }, now),
    ).toBe(true);
  });

  it("returns true when frozen well over 24 hours ago", () => {
    const now = 1_700_000_000_000;
    expect(
      isFrozenOver24h({ pausedByBilling: true, frozenAt: now - 5 * DAY }, now),
    ).toBe(true);
  });

  it("returns false when pausedByBilling=true but frozenAt is missing (defensive)", () => {
    const now = 1_700_000_000_000;
    expect(
      isFrozenOver24h({ pausedByBilling: true, frozenAt: undefined }, now),
    ).toBe(false);
  });
});
