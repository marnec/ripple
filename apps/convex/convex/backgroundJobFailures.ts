/**
 * Where a background drain goes when it gives up.
 *
 * Every retried pool in this codebase points its `onComplete` here. The pool
 * calls it once per work item with the terminal outcome — success, the failure
 * that outlived the last attempt, or a cancellation — and only the failure is
 * worth persisting: a drain that converged has already written its result
 * everywhere it matters, and a canceled one was canceled on purpose.
 *
 * The alternative this replaces is `_scheduled_functions` plus the logs, which
 * is a 7-day window nobody opens unless they already suspect something.
 */

import { v } from "convex/values";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { internalMutation } from "./functions";
import type { MutationCtx } from "./_generated/server";

/**
 * The one write into this table. Mutations cannot call mutations, so the
 * handlers below and `emailDelivery.recordEmailTerminalFailure` — which has a
 * row of its own to correct on top of this — all land here instead.
 */
export async function insertJobFailure(
  ctx: MutationCtx,
  failure: { kind: string; key: string; error: string },
): Promise<void> {
  await ctx.db.insert("backgroundJobFailures", {
    ...failure,
    failedAt: Date.now(),
  });
}

/** Names the drain (`module:function`) and the thing it was draining. */
export const vJobContext = v.object({ kind: v.string(), key: v.string() });

/** What an enqueue site passes so a terminal failure can name itself. */
export type BackgroundJob = { kind: string; key: string };

/**
 * `onComplete` for every retried background pool.
 *
 * Runs as a mutation in its own transaction, so it is exactly-once the way the
 * drain itself is not — the recording cannot be the thing that goes missing.
 */
export const recordTerminalFailure = internalMutation({
  // `v.any()` is passed explicitly: workpool 0.4.10's `vOnCompleteArgs` defaults
  // its return-value validator to `v.optional(v.any()) as unknown as VReturn`,
  // which emits `returnValue?: any` into the generated api types while its own
  // `RunResult<T>` still declares `returnValue` required — so the `onComplete`
  // reference stops matching `OnCompleteArgs` at every enqueue site. Drop this
  // second argument once the package's validator and type agree again.
  args: vOnCompleteArgs(vJobContext, v.any()),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind !== "failed") return null;

    await insertJobFailure(ctx, {
      kind: context.kind,
      key: context.key,
      error: result.error,
    });
    return null;
  },
});

/**
 * The same surface, reached from an action rather than a pool's `onComplete`.
 *
 * Outbound integration writes give up in a place no pool can see: the provider
 * POST already committed, and it is the *recorder* that could not be persisted
 * (`core/runOutboundAction.ts`). The action cannot re-throw to get retried —
 * that would re-POST a non-idempotent create — so this is the only report it
 * can make, and Ripple's mirror stays behind the provider until someone acts
 * on the row.
 */
export const recordOutboundAbandoned = internalMutation({
  args: { kind: v.string(), key: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertJobFailure(ctx, args);
    return null;
  },
});
