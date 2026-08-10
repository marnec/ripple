import type {
  OutboundGateway,
  OutboundOutcome,
  OutboundRecorderSink,
} from "./outboundPort";

/**
 * The whole body of every outbound action (9 ops × 2 providers): resolve the
 * provider gateway, record a permanent failure when credentials are missing,
 * otherwise run the op's single gateway call and turn its outcome into the
 * retrier's return-vs-throw contract.
 *
 * Contract with `@convex-dev/action-retrier`:
 *  - return cleanly → retrier stops (success or permanent fail).
 *  - throw          → retrier backs off and retries.
 *
 * `resolveGateway` is the only genuinely per-provider seam — GitHub mints a
 * token synchronously from the installation id (`makeGithubGateway`), GitLab
 * fetches/refreshes a stored token (async) — hence the sync|async union. `sink`
 * is the op's recorder (provider-neutral, from `core/outboundSinks`) and `call`
 * is the single `OutboundGateway` method this op invokes. Returns `null` so an
 * action handler is just `(ctx, args) => runProviderOutbound({ ... })`.
 *
 * Adding an outbound op or a provider no longer re-spells any of this; it
 * supplies only the sink and the one gateway call. Every collaborator is a
 * plain interface (`core/outboundPort`, no Convex types), so the entire
 * decision is exercised in a pure unit test with a fake gateway and a spy sink
 * — no `"use node"`, no env, no HTTP, no `convex-test`. See
 * `tests/integrations.runOutboundAction.test.ts`.
 */
export async function runProviderOutbound(opts: {
  resolveGateway: () =>
    | OutboundGateway
    | null
    | Promise<OutboundGateway | null>;
  credsMissing: string;
  sink: OutboundRecorderSink;
  call: (gateway: OutboundGateway) => Promise<OutboundOutcome>;
}): Promise<null> {
  const gateway = await opts.resolveGateway();
  if (!gateway) {
    await opts.sink.recordPermanentFailure(opts.credsMissing);
    return null;
  }

  const outcome = await opts.call(gateway);
  switch (outcome.kind) {
    case "success":
      await opts.sink.recordSuccess(outcome.meta);
      return null;
    case "permanent_fail":
      await opts.sink.recordPermanentFailure(outcome.message, outcome.httpStatus);
      return null;
    case "retryable":
      // The adapter already pre-slept on a 429 before returning; throwing now
      // hands control back to the retrier, which adds its own backoff on top.
      throw new Error(
        `Outbound transient failure: ${outcome.message}; retrier will back off`,
      );
  }
}
