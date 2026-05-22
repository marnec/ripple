import type { OutboundOutcome } from "./outboundPort";
import type { OutboundRecorderSink } from "./outboundRecorderSink";

/**
 * The per-attempt `classify → record → throw` loop, extracted from every
 * outbound action body so it exists — and is tested — exactly once.
 *
 * Contract with `@convex-dev/action-retrier`:
 *  - return cleanly → retrier stops (success or permanent fail).
 *  - throw          → retrier backs off and retries.
 *
 * `op` is a thunk so this function is gateway-method-agnostic: callers pass
 * `() => gateway.setIssueState({ ... })`. Both `op` and `sink` are plain
 * interfaces (no Convex types), so the whole decision can be exercised in a
 * pure unit test with a fake gateway and a spy sink — no `"use node"`, no env,
 * no HTTP, no `convex-test`.
 */
export async function runOutboundOp(
  op: () => Promise<OutboundOutcome>,
  sink: OutboundRecorderSink,
): Promise<"success" | "permanent_fail"> {
  const outcome = await op();
  switch (outcome.kind) {
    case "success":
      await sink.recordSuccess(outcome.meta);
      return "success";
    case "permanent_fail":
      await sink.recordPermanentFailure(outcome.message, outcome.httpStatus);
      return "permanent_fail";
    case "retryable":
      // The adapter already pre-slept on a 429 before returning; throwing now
      // hands control back to the retrier, which adds its own backoff on top.
      throw new Error(
        `GitHub outbound transient failure: ${outcome.message}; retrier will back off`,
      );
  }
}
