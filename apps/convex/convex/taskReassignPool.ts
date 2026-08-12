/**
 * The retry machinery for the batched task and tag drains.
 *
 * Three drains run here: `taskStatuses.syncTasksCompleted`,
 * `taskStatuses.reassignTasksAndDelete` and `tagSync.stripTagEverywhere`. All
 * three are the tail of a user-facing mutation that has already committed the
 * decision — the column is toggled, the status or tag is marked
 * `pendingDeletion` — and left the unbounded rewrite to run behind it. A drain
 * that dies therefore leaves the visible half of the change in place and the
 * bulk half undone: a tag gone from every picker but still on every resource,
 * a status marked for deletion that never goes away.
 *
 * They were already enqueued through this pool for scheduler contention, but
 * the pool was not retrying them, which for an *action* means at-most-once —
 * one thrown batch and the drain is gone with nothing to notice it.
 */

import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { BackgroundJob } from "./backgroundJobFailures";
import type {
  FunctionReference,
  SchedulableFunctionReference,
  OptionalRestArgs,
} from "convex/server";

const pool = new Workpool(components.taskReassignPool, {
  maxParallelism: 4,
  retryActionsByDefault: true,
  // These fail on write conflicts against the same task rows a user is editing,
  // which clear in milliseconds. Five attempts over ~8s of backoff.
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 500, base: 2 },
});

/**
 * Enqueue one batched drain.
 *
 * **Restart safety.** A retry restarts the drain from the beginning rather than
 * from the batch that failed, so batches must converge rather than accumulate.
 * All three do, and each for the same reason: the batch selects only the rows
 * that still disagree with the target state (`syncTasksCompletedBatch` reads
 * `completed !== status.isCompleted`; `fetchTasksForStatusBatch` reads the
 * status being emptied; `stripTagBatch` reads join rows it then deletes), so a
 * replayed batch finds the work already done and moves on. A drain whose
 * batches append, increment or send does not belong here without a persisted
 * cursor of its own.
 */
export async function scheduleTaskReassign<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  job: BackgroundJob,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  await pool.enqueueAction(ctx, fn, ...(args as [any]), {
    onComplete: internal.backgroundJobFailures.recordTerminalFailure,
    context: job,
  });
}
