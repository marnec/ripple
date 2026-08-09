import { describe, expect, it } from "vitest";
import { computeIdle, IDLE_AFTER_MS } from "./awareness-activity";

const NOW = 1_000_000;

describe("computeIdle", () => {
  it("is active while the tab is visible and recently used", () => {
    expect(
      computeIdle({ documentHidden: false, lastInputAt: NOW - 30_000, now: NOW }),
    ).toBe(false);
  });

  it("stays active through a long read — being still is not being away", () => {
    expect(
      computeIdle({ documentHidden: false, lastInputAt: NOW - (IDLE_AFTER_MS - 1_000), now: NOW }),
    ).toBe(false);
  });

  it("goes idle once input stops for longer than the timeout", () => {
    expect(
      computeIdle({ documentHidden: false, lastInputAt: NOW - (IDLE_AFTER_MS + 1), now: NOW }),
    ).toBe(true);
  });

  it("goes idle the moment the tab is hidden, however recent the input", () => {
    expect(computeIdle({ documentHidden: true, lastInputAt: NOW, now: NOW })).toBe(true);
  });

  it("honours an explicit timeout", () => {
    const args = { documentHidden: false, lastInputAt: NOW - 45_000, now: NOW };

    expect(computeIdle({ ...args, idleAfterMs: 30_000 })).toBe(true);
    expect(computeIdle({ ...args, idleAfterMs: 60_000 })).toBe(false);
  });
});
