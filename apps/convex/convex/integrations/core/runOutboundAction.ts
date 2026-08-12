import type {
  OutboundGateway,
  OutboundLookup,
  OutboundOutcome,
  OutboundRecorderSink,
} from "./outboundPort";

/**
 * Backoff between recorder attempts. Short and few on purpose: this retry
 * exists to ride out a blip between a committed POST and its mirror, not to
 * outlast an outage — the action holding it open is already inside the
 * retrier's own attempt.
 */
const RECORDER_RETRY_DELAYS_MS = [100, 400];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a recorder, retrying a few times, and **never throw**.
 *
 * This is the whole reason the recorder is not just `await`ed: the file's
 * contract with the retrier is "throw → retry the action", and the action's
 * first act is a non-idempotent POST. A recorder that threw would therefore
 * buy a second GitHub issue or a duplicated comment for a failure that
 * happened *after* the write already succeeded — damage Ripple cannot undo.
 * Giving up silently loses the mirror; giving up loudly loses the user's data.
 */
async function recordWithRetry(
  record: () => Promise<void>,
  abandon?: (error: string) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await record();
      return;
    } catch (error) {
      if (attempt >= RECORDER_RETRY_DELAYS_MS.length) {
        // Last stop. `abandon` writes the "mirror lost" row; if even that is
        // unreachable there is nowhere left to report to, and reporting is not
        // worth a duplicate issue.
        await abandon?.(String(error)).catch(() => {});
        return;
      }
      await sleep(RECORDER_RETRY_DELAYS_MS[attempt]);
    }
  }
}

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
 * That second line is why only the *gateway* may decide to throw. Everything
 * after the gateway call has already changed the provider's state, and the
 * cheapest op here — a create — is not idempotent, so a throw raised by the
 * recorder buys a second issue for a failure that cost nothing. Hence the two
 * asymmetries below: `recordWithRetry` swallows, and `precheck` lets a create
 * that was retried anyway (transport failure past a committed POST) find the
 * issue the last attempt made instead of making another.
 *
 * `resolveGateway` is the only genuinely per-provider seam — GitHub mints a
 * token synchronously from the installation id (`makeGithubGateway`), GitLab
 * fetches/refreshes a stored token (async) — hence the sync|async union. `sink`
 * is the op's recorder (provider-neutral, from `core/outboundSinks`) and `call`
 * is the single `OutboundGateway` method this op invokes. Returns `null` so an
 * action handler is just `(ctx, args) => runProviderOutbound({ ... })`.
 *
 * Adding an outbound op or a provider no longer re-spells any of this; it
 * supplies only the sink, the one gateway call, and — for creates alone — the
 * `precheck` that keeps a retry from making a second issue. Every collaborator is a
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
  /**
   * Creates only. Runs before `call` and short-circuits it when the host
   * already holds the thing this op would create — see the block comment at
   * the use site.
   */
  precheck?: (gateway: OutboundGateway) => Promise<OutboundLookup>;
}): Promise<null> {
  const gateway = await opts.resolveGateway();
  if (!gateway) {
    await opts.sink.recordPermanentFailure(opts.credsMissing);
    return null;
  }

  // A create is the one op that cannot be safely repeated, and the retrier
  // repeats it whenever an attempt fails after the POST committed — a dropped
  // response, a timeout past the write. The precheck asks the host whether the
  // previous attempt got through, using the provenance marker the create
  // itself carries. Only a definite "found" skips the POST: an `absent` or an
  // `unavailable` lookup both fall through, because refusing to create an
  // issue because the *search* is degraded is a worse failure than the
  // duplicate it would prevent.
  if (opts.precheck) {
    const existing = await opts.precheck(gateway);
    if (existing.kind === "found") {
      await recordWithRetry(
        () => opts.sink.recordSuccess(existing.meta),
        opts.sink.recordAbandoned?.bind(opts.sink),
      );
      return null;
    }
  }

  const outcome = await opts.call(gateway);
  switch (outcome.kind) {
    case "success":
      await recordWithRetry(
        () => opts.sink.recordSuccess(outcome.meta),
        opts.sink.recordAbandoned?.bind(opts.sink),
      );
      return null;
    case "permanent_fail":
      // Deliberately not wrapped. A permanent failure means the provider
      // rejected the write, so there is no committed state for a retry to
      // duplicate — the op simply runs again and is rejected again. It is only
      // the *success* path where a re-run costs something irreversible.
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
