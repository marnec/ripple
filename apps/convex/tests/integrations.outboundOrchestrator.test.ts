import { describe, expect, it } from "vitest";
import { runOutboundOp } from "../convex/integrations/core/outboundOrchestrator";
import type {
  OutboundOutcome,
  OutboundSuccessMeta,
} from "../convex/integrations/core/outboundPort";
import type { OutboundRecorderSink } from "../convex/integrations/core/outboundRecorderSink";

/**
 * Pure unit tests for the per-attempt orchestration — the decision logic that
 * was previously buried in seven `"use node"` action bodies and reachable only
 * with real env creds + a real GithubClient. A spy sink captures what the
 * orchestrator recorded; no Convex runtime, no HTTP, no convex-test.
 */

function recordingSink() {
  const calls = {
    success: [] as OutboundSuccessMeta[],
    failure: [] as { message: string; httpStatus?: number }[],
  };
  const sink: OutboundRecorderSink = {
    recordSuccess: async (m) => {
      calls.success.push(m);
    },
    recordPermanentFailure: async (message, httpStatus) => {
      calls.failure.push({ message, httpStatus });
    },
  };
  return { sink, calls };
}

const op = (outcome: OutboundOutcome) => () => Promise.resolve(outcome);

describe("runOutboundOp", () => {
  it("success: records the meta, writes no failure, returns 'success'", async () => {
    const { sink, calls } = recordingSink();
    const ts = Date.parse("2026-05-22T10:00:00Z");

    const decision = await runOutboundOp(
      op({ kind: "success", meta: { externalUpdatedAt: ts } }),
      sink,
    );

    expect(decision).toBe("success");
    expect(calls.success).toEqual([{ externalUpdatedAt: ts }]);
    expect(calls.failure).toHaveLength(0);
  });

  it("success: forwards the provider's updated_at verbatim (not Date.now())", async () => {
    const { sink, calls } = recordingSink();
    const ts = 1_700_000_500_000;

    await runOutboundOp(op({ kind: "success", meta: { externalUpdatedAt: ts } }), sink);

    expect(calls.success[0]?.externalUpdatedAt).toBe(ts);
  });

  it("permanent_fail: records lastSyncError, writes no success, returns 'permanent_fail'", async () => {
    const { sink, calls } = recordingSink();

    const decision = await runOutboundOp(
      op({ kind: "permanent_fail", message: "Not Found", httpStatus: 404 }),
      sink,
    );

    expect(decision).toBe("permanent_fail");
    expect(calls.failure).toEqual([{ message: "Not Found", httpStatus: 404 }]);
    expect(calls.success).toHaveLength(0);
  });

  it("permanent_fail: forwards an undefined httpStatus (e.g. network message)", async () => {
    const { sink, calls } = recordingSink();

    await runOutboundOp(op({ kind: "permanent_fail", message: "boom" }), sink);

    expect(calls.failure).toEqual([{ message: "boom", httpStatus: undefined }]);
  });

  it("retryable: throws so the retrier backs off, records nothing", async () => {
    const { sink, calls } = recordingSink();

    await expect(
      runOutboundOp(op({ kind: "retryable", message: "503" }), sink),
    ).rejects.toThrow(/transient failure/i);

    expect(calls.success).toHaveLength(0);
    expect(calls.failure).toHaveLength(0);
  });
});
