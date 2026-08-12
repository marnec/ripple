/**
 * The push-delivery lane.
 *
 * **This pool does not retry, and that is the design.** A push notification has
 * no dedupe key on the delivery side — the browser shows whatever arrives — so
 * a retried `deliverPush` after a partially-successful fan-out re-notifies
 * everyone it already reached. For a notification, a duplicate is worse than a
 * miss: the missed one is invisible, the duplicate is a buzzing phone. Push is
 * therefore deliberately at-most-once, and the retried background work of T6
 * lives in other pools (`subscriptionPool`, `taskReassignPool`, `emailPool`) so
 * that a backlog there cannot occupy the slots delivery needs.
 *
 * If a future caller needs a retried push, it needs a dedupe key first.
 */

import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { FunctionReference, SchedulableFunctionReference, OptionalRestArgs } from "convex/server";

const pool = new Workpool(components.notificationPool, {
  maxParallelism: 10,
});

/**
 * Schedule a notification action via the workpool.
 * Uses Workpool to avoid scheduler contention from bulk notifications.
 */
export async function scheduleNotification<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  await pool.enqueueAction(ctx, fn, ...args as [any]);
}
