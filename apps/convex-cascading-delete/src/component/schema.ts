/*
(1.) Database schema for batched cascade job tracking
(2.) Persists the traversal frontier between the transactions of one cascade
(3.) Bounded by construction: the frontier is at most depth × page size entries

A batched cascade never holds the whole deletion tree anywhere. Each step
pops the deepest parent off `frontier`, fetches one page of its dependents,
deletes them on the spot and pushes the ones that have rules of their own.
Because a row is deleted the moment it is fetched, the frontier only ever
holds parents that are already gone — at most one page of siblings per level
of the cascade graph, however wide the tree is. That is what lets the job
document carry the entire state of the cascade in one array.
*/

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const frontierEntry = v.object({
  table: v.string(),
  id: v.string(),
  ruleIndex: v.number(),
  probeId: v.optional(v.string()),
});

export const jobStatus = v.union(
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export default defineSchema({
  cascadeJobs: defineTable({
    status: jobStatus,
    frontier: v.array(frontierEntry),
    // Rows a deleter could not remove. Skipped on every later page of the
    // same index range so the cascade can move past them; capped, so a
    // deleter that is broken outright fails the job instead of crawling.
    failedIds: v.array(v.string()),
    batchSize: v.number(),
    maxReadsPerBatch: v.number(),
    deleteHandleStr: v.string(),
    completedCount: v.number(),
    stepCount: v.number(),
    completedSummary: v.string(), // JSON-serialized Record<string, number>
    error: v.optional(v.string()), // JSON-serialized string[] of error messages
    onCompleteHandleStr: v.optional(v.string()), // serialized FunctionReference for completion callback
    onCompleteContext: v.optional(v.string()), // JSON-serialized context passed through to onComplete
  }).index("byStatus", ["status"]),
});
