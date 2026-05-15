import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { applyImportBatch } from "../core/importJob";
import type { NormalizedIssueEvent } from "../core/types";

/**
 * V8-isolate mutations called from the Node-only `drainImportBatch` action
 * via `ctx.runMutation`. Convex requires actions and mutations to live in
 * separate files when the action is `"use node"`-marked.
 */

export const applyBatch = internalMutation({
  args: {
    jobId: v.id("taskImportJobs"),
    events: v.array(v.any()),
    batchStartIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyImportBatch(ctx, {
      jobId: args.jobId,
      events: args.events as NormalizedIssueEvent[],
      batchStartIndex: args.batchStartIndex,
    });
    return null;
  },
});

export const markCompleted = internalMutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "completed",
      completedAt: Date.now(),
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { jobId: v.id("taskImportJobs"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      errorMessage: args.message,
      completedAt: Date.now(),
    });
    return null;
  },
});
