import { describe, expect, it } from "vitest";
import { runProviderOutbound } from "../convex/integrations/core/runOutboundAction";
import type {
  OutboundGateway,
  OutboundLookup,
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

/**
 * A gateway whose every method resolves to the same configured outcome. The
 * marker lookup is the one exception — it answers in `OutboundLookup`, and
 * defaults to `absent` so a test that says nothing about dedupe gets the
 * behaviour of a host that holds no prior attempt.
 */
function fakeGateway(outcome: OutboundOutcome): OutboundGateway {
  const respond = () => Promise.resolve(outcome);
  return {
    findIssueByRippleTask: () =>
      Promise.resolve<OutboundLookup>({ kind: "absent" }),
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

  it("a recorder that always throws still returns cleanly — the retrier must not re-POST", async () => {
    const sink: OutboundRecorderSink = {
      recordSuccess: () => Promise.reject(new Error("recorder down")),
      recordPermanentFailure: async () => {},
    };
    let calls = 0;

    const result = await runProviderOutbound({
      resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) => {
        calls += 1;
        return gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" });
      },
    });

    expect(result).toBeNull();
    expect(calls).toBe(1);
  });

  it("recorder exhaustion reports the last error to recordAbandoned", async () => {
    const abandoned: string[] = [];
    const sink: OutboundRecorderSink = {
      recordSuccess: () => Promise.reject(new Error("recorder down")),
      recordPermanentFailure: async () => {},
      recordAbandoned: async (error) => {
        abandoned.push(error);
      },
    };

    await runProviderOutbound({
      resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) =>
        gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" }),
    });

    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatch(/recorder down/);
  });

  it("a recorder that recovers on a later attempt records once and abandons nothing", async () => {
    const { sink, calls } = recordingSink();
    const abandoned: string[] = [];
    let attempts = 0;
    const flaky: OutboundRecorderSink = {
      ...sink,
      recordSuccess: async (meta) => {
        attempts += 1;
        if (attempts < 2) throw new Error("write conflict");
        await sink.recordSuccess(meta);
      },
      recordAbandoned: async (error) => {
        abandoned.push(error);
      },
    };

    await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({ kind: "success", meta: { issueNumber: 42 } }),
      credsMissing: "creds missing",
      sink: flaky,
      call: (gateway) =>
        gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" }),
    });

    expect(attempts).toBe(2);
    expect(calls.success).toEqual([{ issueNumber: 42 }]);
    expect(abandoned).toHaveLength(0);
  });

  it("an abandon reporter that itself throws is the end of the line, not an escape", async () => {
    const sink: OutboundRecorderSink = {
      recordSuccess: () => Promise.reject(new Error("recorder down")),
      recordPermanentFailure: async () => {},
      recordAbandoned: () => Promise.reject(new Error("surface down too")),
    };

    await expect(
      runProviderOutbound({
        resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
        credsMissing: "creds missing",
        sink,
        call: (gateway) =>
          gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" }),
      }),
    ).resolves.toBeNull();
  });

  /**
   * The other half of the same defect. The recorder retry above keeps a
   * *recorder* failure from re-POSTing, but the retrier still retries genuine
   * transport failures — and a create whose response was lost has already made
   * an issue on the host. The precheck is what makes that second attempt
   * resolve to the issue already there instead of minting a twin nobody in
   * Ripple can reach.
   */
  it("precheck finds the issue: the create is not sent and the found meta is recorded", async () => {
    const { sink, calls } = recordingSink();
    let posted = 0;
    const meta = { externalIssueId: "I_1", issueNumber: 7 };

    const result = await runProviderOutbound({
      resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
      credsMissing: "creds missing",
      sink,
      precheck: () => Promise.resolve({ kind: "found", meta }),
      call: (gateway) => {
        posted += 1;
        return gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" });
      },
    });

    expect(posted).toBe(0);
    expect(calls.success).toEqual([meta]);
    expect(result).toBeNull();
  });

  it("precheck finds nothing: the create goes out as normal", async () => {
    const { sink, calls } = recordingSink();
    let posted = 0;

    await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({ kind: "success", meta: { issueNumber: 9 } }),
      credsMissing: "creds missing",
      sink,
      precheck: () => Promise.resolve({ kind: "absent" }),
      call: (gateway) => {
        posted += 1;
        return gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" });
      },
    });

    expect(posted).toBe(1);
    expect(calls.success).toEqual([{ issueNumber: 9 }]);
  });

  /**
   * Deliberate: the precheck is an optimization on top of a user-initiated
   * create, not a gate in front of it. A degraded lookup (rate-limited search,
   * a permission the token lacks) must not turn "create my issue" into a
   * permanent sync failure for an issue that was never created. The duplicate
   * window reopens only when the lookup AND the first attempt both fail.
   */
  it("precheck unavailable: falls through to the create rather than blocking it", async () => {
    const { sink, calls } = recordingSink();
    let posted = 0;

    const result = await runProviderOutbound({
      resolveGateway: () =>
        fakeGateway({ kind: "success", meta: { issueNumber: 9 } }),
      credsMissing: "creds missing",
      sink,
      precheck: () =>
        Promise.resolve({ kind: "unavailable", message: "HTTP 429" }),
      call: (gateway) => {
        posted += 1;
        return gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" });
      },
    });

    expect(posted).toBe(1);
    expect(calls.success).toEqual([{ issueNumber: 9 }]);
    expect(result).toBeNull();
  });

  it("a found issue is recorded through the same retry-and-abandon path as a fresh create", async () => {
    const abandoned: string[] = [];
    const sink: OutboundRecorderSink = {
      recordSuccess: () => Promise.reject(new Error("recorder down")),
      recordPermanentFailure: async () => {},
      recordAbandoned: async (error) => {
        abandoned.push(error);
      },
    };

    await expect(
      runProviderOutbound({
        resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
        credsMissing: "creds missing",
        sink,
        precheck: () => Promise.resolve({ kind: "found", meta: { issueNumber: 7 } }),
        call: (gateway) =>
          gateway.createIssue({ projectRef: "o/r", title: "t", body: "b" }),
      }),
    ).resolves.toBeNull();
    expect(abandoned).toHaveLength(1);
  });

  it("no precheck: every non-create op is untouched", async () => {
    const { sink, calls } = recordingSink();
    let posted = 0;

    await runProviderOutbound({
      resolveGateway: () => fakeGateway({ kind: "success", meta: {} }),
      credsMissing: "creds missing",
      sink,
      call: (gateway) => {
        posted += 1;
        return gateway.setDescription(DESCRIBE_ARGS);
      },
    });

    expect(posted).toBe(1);
    expect(calls.success).toHaveLength(1);
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
