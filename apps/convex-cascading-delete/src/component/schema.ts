/*
(1.) Database schema for batch deletion job tracking and management
(2.) Stores job state, progress, and completion summaries for large cascading deletes
(3.) Uses chunked target storage to avoid document size limits

This schema defines tables for managing batched cascade delete operations. The
deletionJobs table tracks lifecycle state, progress, and completion summaries.
The deletionTargetChunks table stores deletion targets in chunks (~500 per doc)
to avoid the 1MB document size limit that occurs with large target arrays.
A Convex Workflow drives the batch processing loop, providing automatic retry,
crash recovery, and cancellation support.
*/

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  deletionJobs: defineTable({
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    totalTargetCount: v.number(),
    totalChunkCount: v.number(),
    dispatchedChunkCount: v.number(),
    batchSize: v.number(),
    deleteHandleStr: v.string(),
    completedCount: v.number(),
    completedSummary: v.string(),   // JSON-serialized Record<string, number>
    error: v.optional(v.string()),  // JSON-serialized string[] of error messages
    onCompleteHandleStr: v.optional(v.string()), // serialized FunctionReference for completion callback
    onCompleteContext: v.optional(v.string()), // JSON-serialized context passed through to onComplete
    workflowId: v.optional(v.string()), // workflow ID for cancellation
  }).index("byStatus", ["status"]),

  deletionTargetChunks: defineTable({
    jobId: v.id("deletionJobs"),
    chunkIndex: v.number(),
    targets: v.array(v.object({ table: v.string(), id: v.string() })),
  }).index("by_job_chunk", ["jobId", "chunkIndex"]),
});
