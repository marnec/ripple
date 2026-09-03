/*
(1.) Component backend functions for the batched cascade job lifecycle
(2.) Owns the persisted frontier and drives the step chain via the scheduler
(3.) Traversal itself runs app-side: a component cannot read the app's tables

A batched cascade is a chain of app mutations, one transaction each. The app's
step handler (see `makeBatchDeleteHandler`) loads the frontier with `loadJob`,
spends one transaction's budget deleting and expanding, then hands the result
back through `saveStep`, which either schedules the next step or finalizes the
job and fires the completion callback. The scheduler is the durability story:
the next step is scheduled inside the transaction that commits the previous
one, so a step that commits always has a successor, and one that fails with a
system error is retried by Convex before anything is scheduled.
*/

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { frontierEntry, jobStatus } from "./schema.js";

/** Above this many undeletable rows the cascade is broken, not unlucky. */
export const MAX_FAILED_IDS = 256;
/** Error messages kept on the job document; the rest are counted. */
const MAX_STORED_ERRORS = 64;
/** Convex caps arrays at 8192 elements; stay well under it. */
export const MAX_FRONTIER = 4096;

/** Delay between steps. A breather for the scheduler, not a rate limit. */
const STEP_DELAY_MS = 0;

const jobArgs = {
  frontier: v.array(frontierEntry),
  failedIds: v.array(v.string()),
  batchSummary: v.string(),
  errors: v.optional(v.string()),
};

/**
 * Persists the state left over from the inline first step and schedules the
 * next one. Only called when the inline step ran out of budget: a cascade
 * that finishes inline never creates a job.
 */
export const createJob = mutation({
  args: {
    ...jobArgs,
    deleteHandleStr: v.string(),
    batchSize: v.number(),
    maxReadsPerBatch: v.number(),
    onCompleteHandleStr: v.optional(v.string()),
    onCompleteContext: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (args.batchSize < 1 || args.maxReadsPerBatch < 1) {
      throw new Error("batchSize and maxReadsPerBatch must be at least 1");
    }
    if (args.frontier.length === 0) {
      throw new Error("createJob called with an empty frontier; the cascade is already complete");
    }
    const summary = JSON.parse(args.batchSummary) as Record<string, number>;
    const jobId = await ctx.db.insert("cascadeJobs", {
      status: "processing",
      frontier: args.frontier,
      failedIds: args.failedIds,
      batchSize: args.batchSize,
      maxReadsPerBatch: args.maxReadsPerBatch,
      deleteHandleStr: args.deleteHandleStr,
      completedCount: sumCounts(summary),
      stepCount: 1,
      completedSummary: args.batchSummary,
      error: args.errors,
      onCompleteHandleStr: args.onCompleteHandleStr,
      onCompleteContext: args.onCompleteContext,
    });

    await ctx.scheduler.runAfter(STEP_DELAY_MS, args.deleteHandleStr as any, { jobId });
    return jobId;
  },
});

/**
 * What a step needs to run: the frontier, the skip-set and the budgets.
 * Returns null for a job that no longer exists or is no longer processing
 * (cancelled, or already finalized), which tells the step to stand down.
 */
export const loadJob = query({
  args: { jobId: v.string() },
  returns: v.union(
    v.object({
      frontier: v.array(frontierEntry),
      failedIds: v.array(v.string()),
      batchSize: v.number(),
      maxReadsPerBatch: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"cascadeJobs">);
    if (!job || job.status !== "processing") return null;
    return {
      frontier: job.frontier,
      failedIds: job.failedIds,
      batchSize: job.batchSize,
      maxReadsPerBatch: job.maxReadsPerBatch,
    };
  },
});

/**
 * Records one step's work. Merges the batch summary and errors, stores the
 * new frontier, then either schedules the next step or — when the frontier is
 * empty, or the step gave up — finalizes the job and fires `onComplete`.
 */
export const saveStep = mutation({
  args: {
    jobId: v.string(),
    ...jobArgs,
    done: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, frontier, failedIds, batchSummary, errors, done }) => {
    const job = await ctx.db.get(jobId as Id<"cascadeJobs">);
    // Cancelled between load and save: the step's deletes stand (they were
    // real rows the cascade owned), but nothing further is scheduled.
    if (!job || job.status !== "processing") return null;

    const summary = JSON.parse(job.completedSummary) as Record<string, number>;
    const batch = JSON.parse(batchSummary) as Record<string, number>;
    for (const [table, count] of Object.entries(batch)) {
      summary[table] = (summary[table] ?? 0) + count;
    }

    const tooManyFailures = failedIds.length > MAX_FAILED_IDS;
    const finished = done || tooManyFailures;
    // The abort reason goes first so the bounded list can never push it out.
    const mergedErrors = mergeErrors(
      tooManyFailures
        ? mergeErrors(
            JSON.stringify([`aborted: more than ${MAX_FAILED_IDS} rows could not be deleted`]),
            job.error,
          )
        : job.error,
      errors,
    );
    const status = !finished
      ? ("processing" as const)
      : mergedErrors
        ? ("failed" as const)
        : ("completed" as const);

    await ctx.db.patch(job._id, {
      status,
      frontier,
      failedIds,
      completedCount: job.completedCount + sumCounts(batch),
      stepCount: job.stepCount + 1,
      completedSummary: JSON.stringify(summary),
      error: mergedErrors,
    });

    if (!finished) {
      await ctx.scheduler.runAfter(STEP_DELAY_MS, job.deleteHandleStr as any, { jobId });
      return null;
    }

    if (job.onCompleteHandleStr) {
      await ctx.scheduler.runAfter(0, job.onCompleteHandleStr as any, {
        summary: JSON.stringify(summary),
        status,
        context: job.onCompleteContext,
      });
    }
    return null;
  },
});

/**
 * Cancels a running job. The step already scheduled still fires, sees the
 * job is no longer processing, and returns without touching anything.
 */
export const cancelJob = mutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"cascadeJobs">);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    if (job.status !== "processing") {
      return null; // Already in a terminal state
    }
    await ctx.db.patch(job._id, { status: "cancelled" });
    return null;
  },
});

/**
 * Current status of a cascade job. Reactive: updates as steps commit.
 */
export const getJobStatus = query({
  args: { jobId: v.string() },
  returns: v.union(
    v.object({
      status: jobStatus,
      completedCount: v.number(),
      pendingCount: v.number(),
      stepCount: v.number(),
      completedSummary: v.string(),
      error: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"cascadeJobs">);
    if (!job) return null;
    return {
      status: job.status,
      completedCount: job.completedCount,
      pendingCount: job.frontier.length,
      stepCount: job.stepCount,
      completedSummary: job.completedSummary,
      error: job.error,
    };
  },
});

function sumCounts(summary: Record<string, number>): number {
  return Object.values(summary).reduce((sum, n) => sum + n, 0);
}

/**
 * Appends a step's errors to the job's, keeping the stored list bounded. The
 * job document has to stay under 1 MiB whatever a broken deleter says. The
 * overflow is folded into a trailing "...and N more" entry.
 */
function mergeErrors(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (!incoming) return existing;
  const prior = existing ? (JSON.parse(existing) as string[]) : [];
  const next = JSON.parse(incoming) as string[];
  const overflowOf = (e: string) => /^\.\.\.and (\d+) more$/.exec(e);
  const isOverflow = (e: string) => overflowOf(e) !== null;
  const priorOverflow = prior.filter(isOverflow).reduce((n, e) => n + Number(overflowOf(e)![1]), 0);
  const messages = [...prior.filter((e) => !isOverflow(e)), ...next.filter((e) => !isOverflow(e))];
  const total = messages.length + priorOverflow;
  const kept = messages.slice(0, MAX_STORED_ERRORS);
  if (total > kept.length) kept.push(`...and ${total - kept.length} more`);
  return JSON.stringify(kept);
}
