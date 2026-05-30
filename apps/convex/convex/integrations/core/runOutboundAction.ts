import type { OutboundGateway, OutboundOutcome } from "./outboundPort";
import type { OutboundRecorderSink } from "./outboundRecorderSink";
import { runOutboundOp } from "./outboundOrchestrator";

/**
 * The shell every outbound action body repeated 18× (9 ops × 2 providers):
 * resolve the provider gateway, record a permanent failure when credentials are
 * missing, otherwise run the op's single gateway call through the orchestrator.
 *
 * `resolveGateway` is the only genuinely per-provider seam — GitHub mints a
 * token synchronously from the installation id (`makeGithubGateway`), GitLab
 * fetches/refreshes a stored token (async) — hence the sync|async union. `sink`
 * is the op's recorder (provider-neutral, from `core/outboundSinks`) and `call`
 * is the single `OutboundGateway` method this op invokes. Returns `null` so an
 * action handler is just `(ctx, args) => runProviderOutbound({ ... })`.
 *
 * Adding an outbound op or a provider no longer re-spells the gateway-guard +
 * orchestrator wiring; it supplies only the sink and the one gateway call.
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
  await runOutboundOp(() => opts.call(gateway), opts.sink);
  return null;
}
