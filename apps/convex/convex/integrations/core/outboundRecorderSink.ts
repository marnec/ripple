import type { OutboundSuccessMeta } from "./outboundPort";

/**
 * The driving port for persistence. The orchestrator writes an op's outcome
 * through this sink without knowing which recorder mutation runs or which
 * row it targets (taskId vs commentId vs commentLinkId). Concrete sinks are
 * built in `github/outboundSinks.ts`, each closing over an `ActionCtx` and a
 * `FunctionReference` to an `internal` recorder mutation — that closure is the
 * only place the mutation↔action boundary is crossed.
 *
 * Like `outboundPort`, this module has zero Convex runtime imports so the
 * orchestrator stays unit-testable with a spy sink.
 */
export interface OutboundRecorderSink {
  recordSuccess(meta: OutboundSuccessMeta): Promise<void>;
  recordPermanentFailure(message: string, httpStatus?: number): Promise<void>;
}
