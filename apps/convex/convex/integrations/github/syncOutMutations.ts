import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * V8-isolate mutations invoked from the Node-only outbound action.
 * Co-located so future Phase 9 "Force resync" wiring drops in here too.
 */

export const recordOutboundSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    newExternalState: v.union(v.literal("open"), v.literal("closed")),
    newExternalStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      externalState: args.newExternalState,
      externalStateReason: args.newExternalStateReason,
      externalUpdatedAt: Date.now(),
      lastSyncError: undefined,
    });
    return null;
  },
});

export const recordOutboundFailure = internalMutation({
  args: {
    taskId: v.id("tasks"),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      lastSyncError: {
        occurredAt: Date.now(),
        message: args.message,
        httpStatus: args.httpStatus,
      },
    });
    return null;
  },
});
