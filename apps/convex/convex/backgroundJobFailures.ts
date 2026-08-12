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
  args: vOnCompleteArgs(vJobContext),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind !== "failed") return null;

    await ctx.db.insert("backgroundJobFailures", {
      kind: context.kind,
      key: context.key,
      error: result.error,
      failedAt: Date.now(),
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
    await ctx.db.insert("backgroundJobFailures", {
      kind: args.kind,
      key: args.key,
      error: args.error,
      failedAt: Date.now(),
    });
    return null;
  },
});
