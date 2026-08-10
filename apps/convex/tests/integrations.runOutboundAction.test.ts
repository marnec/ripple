import { describe, expect, it } from "vitest";
import { runProviderOutbound } from "../convex/integrations/core/runOutboundAction";
import type {
  OutboundGateway,
  OutboundOutcome,
  OutboundRecorderSink,
  OutboundSuccessMeta,
} from "../convex/integrations/core/outboundPort";

/**
 * Pure unit tests for the outbound runner — the shell every outbound action
 * body delegates to (9 ops × 2 providers). A fake gateway goes in, a spy sink
 * captures what was recorded; no Convex runtime, no `"use node"`, no HTTP, no
 * `convex-test`.
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

/** A gateway whose every method resolves to the same configured outcome. */
function fakeGateway(outcome: OutboundOutcome): OutboundGateway {
  const respond = () => Promise.resolve(outcome);
  return {
    createIssue: respond,
    setIssueState: respond,
    setDescription: respond,
    setLabels: respond,
    setAssignees: respond,
    createComment: respond,
    editComment: respond,
    deleteComment: respond,
  };
}

const DESCRIBE_ARGS = {
  projectRef: "octo/repo",
  issueRef: 7,
  markdown: "# hi",
};

describe("runProviderOutbound", () => {
  it("retryable: the thrown message names no provider (GitLab shares this runner)", async () => {
    const { sink } = recordingSink();

    const run = runProviderOutbound({
      resolveGateway: () => fakeGateway({ kind: "retryable", message: "503" }),
      credsMissing: "GitLab credentials not configured",
      sink,
      call: (gateway) =>
        gateway.setIssueState({
          projectRef: "42",
          issueRef: 7,
          state: "closed",
        }),
    });

    await expect(run).rejects.toThrow(/transient failure: 503/i);
    await expect(run).rejects.not.toThrow(/github/i);
  });

  it("retryable: records nothing — the retrier owns the next attempt", async () => {
    const { sink, calls } = recordingSink();

    await expect(
      runProviderOutbound({
        resolveGateway: () => fakeGateway({ kind: "retryable", message: "503" }),
        credsMissing: "creds missing",
        sink,
        call: (gateway) => gateway.setDescription(DESCRIBE_ARGS),
      }),
    ).rejects.toThrow();

    expect(calls.success).toHaveLength(0);
    expect(calls.failure).toHaveLength(0);
  });

  it("no gateway: records the creds-missing failure and never calls the provider", async () => {
    const { sink, calls } = recordingSink();
    let called = false;

    const result = await runProviderOutbound({
      resolveGateway: () => null,
      credsMissing: "GitHub App credentials not configured",
      sink,
      call: (gateway) => {
        called = true;
        return gateway.setDescription(DESCRIBE_ARGS);
      },
    });

    expect(called).toBe(false);
    expect(calls.failure).toEqual([
      { message: "GitHub App credentials not configured", httpStatus: undefined },
    ]);
    expect(calls.success).toHaveLength(0);
    expect(result).toBeNull();
  });

  it("awaits an async resolveGateway (the GitLab stored-token path)", async () => {
    const { sink, calls } = recordingSink();
    const ts = Date.parse("2026-05-22T10:00:00Z");

    const result = await runProviderOutbound({
      resolveGateway: () =>
        Promise.resolve(
          fakeGateway({ kind: "success", meta: { externalUpdatedAt: ts } }),
        ),
      credsMissing: "GitLab credentials not configured",
      sink,
      call: (gateway) => gateway.setDescription(DESCRIBE_ARGS),
    });

    expect(calls.success).toEqual([{ externalUpdatedAt: ts }]);
    expect(result).toBeNull();
  });

  it("an async resolveGateway that yields null still records creds-missing", async () => {
    const { sink, calls } = recordingSink();

    await runProviderOutbound({
      resolveGateway: () => Promise.resolve(null),
      credsMissing: "GitLab credentials not configured",
      sink,
      call: (gateway) => gateway.setDescription(DESCRIBE_ARGS),
    });

    expect(calls.failure).toEqual([
      { message: "GitLab credentials not configured", httpStatus: undefined },
    ]);
  });

  it("success: records the provider's meta verbatim and writes no failure", async () => {
    const { sink, calls } = recordingSink();
    const ts = 1_700_000_500_000;

    const result = await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({
          kind: "success",
          meta: { externalUpdatedAt: ts, issueNumber: 42 },
        }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) =>
        gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" }),
    });

    expect(calls.success).toEqual([{ externalUpdatedAt: ts, issueNumber: 42 }]);
    expect(calls.failure).toHaveLength(0);
    expect(result).toBeNull();
  });

  it("permanent_fail: records message + status, writes no success, does not throw", async () => {
    const { sink, calls } = recordingSink();

    const result = await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({
          kind: "permanent_fail",
          message: "Not Found",
          httpStatus: 404,
        }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) => gateway.setDescription(DESCRIBE_ARGS),
    });

    expect(calls.failure).toEqual([{ message: "Not Found", httpStatus: 404 }]);
    expect(calls.success).toHaveLength(0);
    expect(result).toBeNull();
  });

  it("permanent_fail: forwards an undefined httpStatus (e.g. a network message)", async () => {
    const { sink, calls } = recordingSink();

    await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({ kind: "permanent_fail", message: "boom" }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) => gateway.setDescription(DESCRIBE_ARGS),
    });

    expect(calls.failure).toEqual([{ message: "boom", httpStatus: undefined }]);
  });

  it("hands the resolved gateway to the op — the only per-provider seam", async () => {
    const { sink } = recordingSink();
    const gateway = fakeGateway({ kind: "success", meta: {} });
    let received: OutboundGateway | undefined;

    await runProviderOutbound({
      resolveGateway: () => gateway,
      credsMissing: "creds missing",
      sink,
      call: (g) => {
        received = g;
        return g.setDescription(DESCRIBE_ARGS);
      },
    });

    expect(received).toBe(gateway);
  });
});
