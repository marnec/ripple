import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  deriveDesiredExternalState,
  shouldSkipForEcho,
  shouldSkipForFreeze,
  type OutboundResponse,
} from "../convex/integrations/core/syncOut";

describe("integrations/core/syncOut.classifyResponse", () => {
  it("returns 'success' for a 2xx response", () => {
    const response: OutboundResponse = { status: 200 };
    expect(classifyResponse(response)).toBe("success");
  });

  it.each([400, 401, 403, 404, 422])(
    "returns 'permanent_fail' for 4xx non-429 (%i)",
    (status) => {
      expect(classifyResponse({ status })).toBe("permanent_fail");
    },
  );

  it("returns 'retry' for 429 (rate-limited)", () => {
    expect(classifyResponse({ status: 429, retryAfterMs: 60_000 })).toBe(
      "retry",
    );
  });

  it.each([500, 502, 503, 504])(
    "returns 'retry' for 5xx (%i) — transient server failure",
    (status) => {
      expect(classifyResponse({ status })).toBe("retry");
    },
  );

  it("returns 'retry' for a network error (status null)", () => {
    expect(
      classifyResponse({ status: null, errorMessage: "ECONNRESET" }),
    ).toBe("retry");
  });
});

describe("integrations/core/syncOut.shouldSkipForEcho", () => {
  it("returns true when the desired state already matches the observed state", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: "closed" })).toBe(
      true,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: "open" })).toBe(true);
  });

  it("returns false when desired and observed differ", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: "open" })).toBe(
      false,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: "closed" })).toBe(
      false,
    );
  });

  it("returns false when observed is undefined (never-synced links must push)", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: undefined })).toBe(
      false,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: undefined })).toBe(
      false,
    );
  });
});

describe("integrations/core/syncOut.shouldSkipForFreeze", () => {
  // Truth table over (status × pausedByBilling). Mirrors the effective-link
  // matrix from entitlements: skip = (effectiveLinkStatus !== "active").
  const matrix: ReadonlyArray<{
    status: "configuring" | "active" | "paused" | "disconnected";
    pausedByBilling: boolean;
    skip: boolean;
  }> = [
    { status: "configuring",  pausedByBilling: false, skip: true  },
    { status: "configuring",  pausedByBilling: true,  skip: true  },
    { status: "active",       pausedByBilling: false, skip: false },
    { status: "active",       pausedByBilling: true,  skip: true  },
    { status: "paused",       pausedByBilling: false, skip: true  },
    { status: "paused",       pausedByBilling: true,  skip: true  },
    { status: "disconnected", pausedByBilling: false, skip: true  },
    { status: "disconnected", pausedByBilling: true,  skip: true  },
  ];

  it.each(matrix)(
    "($status, pausedByBilling=$pausedByBilling) → skip=$skip",
    ({ status, pausedByBilling, skip }) => {
      expect(shouldSkipForFreeze({ status, pausedByBilling })).toBe(skip);
    },
  );
});

describe("integrations/core/syncOut.deriveDesiredExternalState", () => {
  it("completed task → state='closed' with default stateReason='completed'", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: true },
        status: { externalCloseReason: undefined },
      }),
    ).toEqual({ state: "closed", stateReason: "completed" });
  });

  it("completed task with externalCloseReason='not_planned' propagates it as the GitHub state_reason", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: true },
        status: { externalCloseReason: "not_planned" },
      }),
    ).toEqual({ state: "closed", stateReason: "not_planned" });
  });

  it("non-completed task → state='open' with no stateReason", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: false },
        status: { externalCloseReason: undefined },
      }),
    ).toEqual({ state: "open" });
  });

  it("non-completed task ignores any status.externalCloseReason value (it only affects close)", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: false },
        status: { externalCloseReason: "not_planned" },
      }),
    ).toEqual({ state: "open" });
  });
});
