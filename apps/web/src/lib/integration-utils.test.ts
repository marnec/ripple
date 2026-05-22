import { describe, expect, it } from "vitest";
import { formatLastWebhook, isFrozenOver24h } from "./integration-utils";

const MIN = 60 * 1000;
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

describe("formatLastWebhook", () => {
  const now = 1_700_000_000_000;

  it("returns 'Never' when no webhook has been received", () => {
    expect(formatLastWebhook(undefined, now)).toBe("Never");
  });

  it("returns 'just now' for a webhook within the last minute", () => {
    expect(formatLastWebhook(now - 30 * 1000, now)).toBe("just now");
  });

  it("returns minutes for a webhook within the last hour", () => {
    expect(formatLastWebhook(now - 5 * MIN, now)).toBe("5m ago");
  });

  it("returns hours for a webhook within the last day", () => {
    expect(formatLastWebhook(now - 3 * HOUR, now)).toBe("3h ago");
  });

  it("returns days for an older webhook", () => {
    expect(formatLastWebhook(now - 2 * DAY, now)).toBe("2d ago");
  });
});
