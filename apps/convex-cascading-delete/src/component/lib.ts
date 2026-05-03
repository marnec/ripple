/*
(1.) Component backend functions for managing batch deletion job lifecycle
(2.) Uses Convex Workflow for durable, retriable batch processing orchestration
(3.) Chunked target storage eliminates 1MB document size limit

This module implements the component's core batch processing logic. Deletion targets
are stored in chunks (separate documents) to avoid the 1MB limit. A Convex Workflow
drives the processing loop, providing automatic retry, crash recovery, and cancellation.
Each workflow step dispatches one chunk of targets to the app's deletion handler.
The app's handler reports completion back via reportBatchComplete, which tracks progress
and detects terminal state.
*/

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server.js";
import { internal, components } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { WorkflowManager } from "@convex-dev/workflow";
import type { FunctionReference } from "convex/server";

const CHUNK_SIZE = 500;

const workflow = new WorkflowManager(components.workflow);

/**
 * Workflow that dispatches deletion target chunks sequentially.
 * Each step reads one chunk, schedules the app's batch handler, and removes the chunk.
 * Automatic retry and crash recovery are provided by the workflow engine.
 */
export const deletionWorkflow = workflow.define({
  args: { jobId: v.string() },
  handler: async (step, { jobId }): Promise<null> => {
    // Loop dispatching chunks until none remain
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await step.runMutation(
        internal.lib.dispatchNextChunk,
        { jobId }
      );
      if (!result.hasMore) {
        break;
      }
    }
    // Mark all chunks as dispatched
    await step.runMutation(internal.lib.markAllDispatched, { jobId });
    return null;
  },
});

/**
 * Creates a new batch deletion job with chunked target storage.
 * Targets are split into chunks of ~500 to avoid document size limits.
 *
 * @param targets - Array of documents to be deleted across batches
 * @param deleteHandleStr - Function handle string for app's batch deletion handler
 * @param batchSize - Number of documents to delete per batch (used by chunk dispatch)
 * @returns Job ID for tracking progress
 */
export const createBatchJob = mutation({
  args: {
    targets: v.array(v.object({ table: v.string(), id: v.string() })),
    deleteHandleStr: v.string(),
    batchSize: v.number(),
    onCompleteHandleStr: v.optional(v.string()),
    onCompleteContext: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { targets, deleteHandleStr, batchSize, onCompleteHandleStr, onCompleteContext }) => {
    // Split targets into chunks
    const chunks: Array<Array<{ table: string; id: string }>> = [];
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      chunks.push(targets.slice(i, i + CHUNK_SIZE));
    }

    const jobId = await ctx.db.insert("deletionJobs", {
      status: "pending",
      totalTargetCount: targets.length,
      totalChunkCount: chunks.length,
      dispatchedChunkCount: 0,
      batchSize,
      deleteHandleStr,
      completedCount: 0,
      completedSummary: JSON.stringify({}),
      onCompleteHandleStr,
      onCompleteContext,
    });

    // Insert target chunks
    for (let i = 0; i < chunks.length; i++) {
      await ctx.db.insert("deletionTargetChunks", {
        jobId,
        chunkIndex: i,
        targets: chunks[i],
      });
    }

    return jobId;
  },
});

/**
 * Starts the deletion workflow for a pending job.
 * Sets status to processing and kicks off the workflow.
 *
 * @param jobId - ID of the job to start processing
 */
export const startProcessing = mutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "pending") {
      throw new Error(`Job ${jobId} is not in pending state`);
    }

    const workflowId = await workflow.start(
      ctx,
      deletionWorkflow as unknown as FunctionReference<"mutation", "internal">,
      { jobId },
    );

    await ctx.db.patch(jobId as Id<"deletionJobs">, {
      status: "processing",
      workflowId: workflowId as string,
    });
  },
});

/**
 * Dispatches the next chunk of targets to the app's deletion handler.
 * Called as a workflow step — reads one chunk, schedules deletion, removes chunk doc.
 *
 * @param jobId - ID of the job being processed
 * @returns Whether more chunks remain
 */
export const dispatchNextChunk = internalMutation({
  args: { jobId: v.string() },
  returns: v.object({ hasMore: v.boolean() }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job || job.status === "cancelled") {
      return { hasMore: false };
    }

    // Get the next undispatched chunk (lowest chunkIndex)
    const chunk = await ctx.db
      .query("deletionTargetChunks")
      .withIndex("by_job_chunk", (q) => q.eq("jobId", jobId as Id<"deletionJobs">))
      .first();

    if (!chunk) {
      return { hasMore: false };
    }

    // Schedule app's deletion handler with chunk targets
    // Targets are batched according to job's batchSize
    const deleteHandle = job.deleteHandleStr as any;
    const targets = chunk.targets;

    // Split chunk into sub-batches if chunk exceeds batchSize
    for (let i = 0; i < targets.length; i += job.batchSize) {
      const batch = targets.slice(i, i + job.batchSize);
      await ctx.scheduler.runAfter(0, deleteHandle, {
        targets: batch,
        jobId,
      });
    }

    // Remove the chunk document and update dispatched count
    await ctx.db.delete(chunk._id);
    await ctx.db.patch(jobId as Id<"deletionJobs">, {
      dispatchedChunkCount: job.dispatchedChunkCount + 1,
    });

    // Check if more chunks remain
    const nextChunk = await ctx.db
      .query("deletionTargetChunks")
      .withIndex("by_job_chunk", (q) => q.eq("jobId", jobId as Id<"deletionJobs">))
      .first();

    return { hasMore: nextChunk !== null };
  },
});

/**
 * Marks job as having all chunks dispatched.
 * Called as final workflow step after all chunks have been dispatched.
 */
export const markAllDispatched = internalMutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) return null;

    // Check if all batches have already reported completion
    if (job.completedCount >= job.totalTargetCount && job.totalTargetCount > 0) {
      const hasErrors = job.error;
      const finalStatus = hasErrors && job.completedCount < job.totalTargetCount
        ? "failed" as const
        : "completed" as const;

      await ctx.db.patch(jobId as Id<"deletionJobs">, {
        status: finalStatus,
      });

      if (job.onCompleteHandleStr) {
        await ctx.scheduler.runAfter(0, job.onCompleteHandleStr as any, {
          summary: job.completedSummary,
          status: finalStatus,
          context: job.onCompleteContext,
        });
      }
    }

    return null;
  },
});

/**
 * Records completion of a batch and updates job progress.
 * Marks job as completed when all chunks are dispatched and all targets are processed.
 *
 * @param jobId - ID of the job
 * @param batchSummary - JSON string of deletion counts for this batch
 * @param errors - Optional JSON string array of error messages for observability
 */
export const reportBatchComplete = mutation({
  args: {
    jobId: v.string(),
    batchSummary: v.string(),
    errors: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, batchSummary, errors }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      return null;
    }

    const currentSummary = JSON.parse(job.completedSummary);
    const batchCounts = JSON.parse(batchSummary);

    for (const [table, count] of Object.entries(batchCounts)) {
      currentSummary[table] = (currentSummary[table] || 0) + (count as number);
    }

    const batchCount = Object.values(batchCounts).reduce(
      (sum: number, count) => sum + (count as number),
      0
    );
    const newCompletedCount = job.completedCount + batchCount;

    const updates: Record<string, unknown> = {
      completedCount: newCompletedCount,
      completedSummary: JSON.stringify(currentSummary),
    };

    // Accumulate errors for observability
    if (errors) {
      const batchErrors = JSON.parse(errors);
      const existingErrors = job.error ? JSON.parse(job.error) : [];
      updates.error = JSON.stringify([...existingErrors, ...batchErrors]);
    }

    // Terminal state: all chunks have been dispatched to batch handlers
    // (matches old semantics where terminal = remainingTargets.length === 0)
    const isTerminal = job.dispatchedChunkCount >= job.totalChunkCount;

    if (isTerminal) {
      const hasErrors = updates.error || job.error;
      updates.status = hasErrors && newCompletedCount < job.totalTargetCount
        ? "failed"
        : "completed";
    }

    await ctx.db.patch(jobId as Id<"deletionJobs">, updates);

    // Schedule callback when job reaches a terminal state (completed or failed)
    if (isTerminal && job.onCompleteHandleStr) {
      await ctx.scheduler.runAfter(0, job.onCompleteHandleStr as any, {
        summary: JSON.stringify(currentSummary),
        status: updates.status,
        context: job.onCompleteContext,
      });
    }

    return null;
  },
});

/**
 * Cancels a running deletion job and its workflow.
 *
 * @param jobId - ID of the job to cancel
 */
export const cancelJob = mutation({
  args: { jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "pending" && job.status !== "processing") {
      return null; // Already in terminal state
    }

    // Cancel the workflow if it exists
    if (job.workflowId) {
      await workflow.cancel(ctx, job.workflowId as any);
    }

    // Clean up remaining target chunks
    const chunks = await ctx.db
      .query("deletionTargetChunks")
      .withIndex("by_job_chunk", (q) => q.eq("jobId", jobId as Id<"deletionJobs">))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    await ctx.db.patch(jobId as Id<"deletionJobs">, {
      status: "cancelled",
    });

    return null;
  },
});

/**
 * Retrieves current status of a deletion job.
 * Reactive query that updates as batches complete.
 *
 * @param jobId - ID of the job to query
 * @returns Job status with progress information
 */
export const getJobStatus = query({
  args: { jobId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      ),
      totalTargetCount: v.number(),
      completedCount: v.number(),
      completedSummary: v.string(),
      error: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId as Id<"deletionJobs">);
    if (!job) {
      return null;
    }

    return {
      status: job.status,
      totalTargetCount: job.totalTargetCount,
      completedCount: job.completedCount,
      completedSummary: job.completedSummary,
      error: job.error,
    };
  },
});
