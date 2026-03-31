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
 *
 * In test environments (convex-test), falls back to ctx.scheduler since
 * component mutations may not be fully supported.
 */
export async function scheduleNotification<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  if (typeof process !== "undefined" && process.env?.VITEST) {
    await ctx.scheduler.runAfter(0, fn, ...args);
    return;
  }
  await pool.enqueueAction(ctx, fn, ...args as [any]);
}
