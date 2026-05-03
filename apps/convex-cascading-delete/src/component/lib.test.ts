/*
(1.) Test suite for component batch deletion job lifecycle management
(2.) Validates job creation with chunked storage, progress reporting, and state transitions
(3.) Uses convex-test to simulate real database operations against component schema

This test suite exercises the component's backend functions that manage batch deletion
jobs. It verifies correct behavior of the job lifecycle from creation through completion,
including chunked target storage, dispatch operations, cancellation, and progressive
summary merging. The tests use convex-test to run against the actual component schema,
ensuring that database operations, validators, and state transitions behave correctly
in a realistic execution environment.
*/

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";

const modules = import.meta.glob("./**/*.ts");


describe("createBatchJob", () => {
  it("should create a job with pending status and correct fields", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "user1" },
        { table: "posts", id: "post1" },
        { table: "posts", id: "post2" },
      ],
      deleteHandleStr: "handle:abc123",
      batchSize: 100,
    });

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).not.toBeNull();
    expect(status!.status).toBe("pending");
    expect(status!.totalTargetCount).toBe(3);
    expect(status!.completedCount).toBe(0);
    expect(status!.completedSummary).toBe(JSON.stringify({}));
  });

  it("should store targets in chunked documents", async () => {
    const t = convexTest(schema, modules);

    // Create targets that will span multiple chunks (CHUNK_SIZE = 500)
    const targets = Array.from({ length: 3 }, (_, i) => ({
      table: "users",
      id: `u${i}`,
    }));

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:xyz",
      batchSize: 50,
    });

    const job = await t.run(async (ctx) => {
      return await ctx.db.get(jobId as any);
    });

    expect(job).not.toBeNull();
    expect((job as any).totalChunkCount).toBe(1);
    expect((job as any).dispatchedChunkCount).toBe(0);

    // Verify chunk was created
    const chunks = await t.run(async (ctx) => {
      return await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].targets).toHaveLength(3);
  });

  it("should split large target sets into multiple chunks", async () => {
    const t = convexTest(schema, modules);

    // Create 750 targets — should produce 2 chunks (500 + 250)
    const targets = Array.from({ length: 750 }, (_, i) => ({
      table: "items",
      id: `item${i}`,
    }));

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:large",
      batchSize: 100,
    });

    const job = await t.run(async (ctx) => {
      return await ctx.db.get(jobId as any);
    });

    expect((job as any).totalChunkCount).toBe(2);

    const chunks = await t.run(async (ctx) => {
      return await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].targets).toHaveLength(500);
    expect(chunks[1].targets).toHaveLength(250);
  });

  it("should handle empty targets array", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:empty",
      batchSize: 100,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.totalTargetCount).toBe(0);
    expect(status!.completedCount).toBe(0);

    const job = await t.run(async (ctx) => {
      return await ctx.db.get(jobId as any);
    });
    expect((job as any).totalChunkCount).toBe(0);
  });
});

describe("getJobStatus", () => {
  it("should return null for non-existent job", async () => {
    const t = convexTest(schema, modules);

    const status = await t.query(api.lib.getJobStatus, {
      jobId: "nonexistent_id_12345",
    });

    expect(status).toBeNull();
  });

  it("should return correct status fields for existing job", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [{ table: "docs", id: "d1" }],
      deleteHandleStr: "handle:test",
      batchSize: 10,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toEqual({
      status: "pending",
      totalTargetCount: 1,
      completedCount: 0,
      completedSummary: "{}",
      error: undefined,
    });
  });
});

describe("dispatchNextChunk", () => {
  it("should return hasMore: false for non-existent job", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId: "nonexistent_id_12345",
    });

    expect(result).toEqual({ hasMore: false });
  });

  it("should return hasMore: false when no chunks remain", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:empty",
      batchSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    const result = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId,
    });

    expect(result).toEqual({ hasMore: false });
  });

  it("should dispatch a chunk and delete the chunk document", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
      ],
      deleteHandleStr: "handle:dispatch",
      batchSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    const result = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId,
    });

    expect(result).toEqual({ hasMore: false });

    // Chunk should be deleted
    const chunks = await t.run(async (ctx) => {
      return await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
    });
    expect(chunks).toHaveLength(0);

    // Dispatched count should be incremented
    const job = await t.run(async (ctx) => {
      return await ctx.db.get(jobId as any);
    });
    expect((job as any).dispatchedChunkCount).toBe(1);
  });

  it("should return hasMore: true when more chunks exist", async () => {
    const t = convexTest(schema, modules);

    // 750 targets = 2 chunks
    const targets = Array.from({ length: 750 }, (_, i) => ({
      table: "items",
      id: `item${i}`,
    }));

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:multi",
      batchSize: 500,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    const result1 = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId,
    });
    expect(result1).toEqual({ hasMore: true });

    const result2 = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId,
    });
    expect(result2).toEqual({ hasMore: false });
  });

  it("should return hasMore: false for cancelled job", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [{ table: "users", id: "u1" }],
      deleteHandleStr: "handle:cancel",
      batchSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "cancelled" });
    });

    const result = await t.mutation(internal.lib.dispatchNextChunk as any, {
      jobId,
    });

    expect(result).toEqual({ hasMore: false });
  });
});

describe("reportBatchComplete", () => {
  it("should increment completed count from batch summary", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "posts", id: "p1" },
        { table: "posts", id: "p2" },
      ],
      deleteHandleStr: "handle:test",
      batchSize: 100,
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1, posts: 2 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.completedCount).toBe(3);
    expect(JSON.parse(status!.completedSummary)).toEqual({
      users: 1,
      posts: 2,
    });
  });

  it("should merge summaries across multiple batch completions", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: Array.from({ length: 10 }, (_, i) => ({
        table: i < 5 ? "users" : "posts",
        id: `id${i}`,
      })),
      deleteHandleStr: "handle:merge",
      batchSize: 5,
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 3, posts: 2 }),
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 2, posts: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.completedCount).toBe(8);
    expect(JSON.parse(status!.completedSummary)).toEqual({
      users: 5,
      posts: 3,
    });
  });

  it("should mark job as completed when all chunks dispatched and all targets processed", async () => {
    const t = convexTest(schema, modules);

    const targets = [
      { table: "users", id: "u1" },
      { table: "posts", id: "p1" },
    ];

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets,
      deleteHandleStr: "handle:complete",
      batchSize: 100,
    });

    // Simulate: all chunks dispatched (dispatch chunk removes chunks and increments count)
    await t.run(async (ctx) => {
      // Delete all chunk docs and mark as fully dispatched
      const chunks = await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
      }
      await ctx.db.patch(jobId as any, {
        status: "processing",
        dispatchedChunkCount: 1, // matches totalChunkCount
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1, posts: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("completed");
    expect(status!.completedCount).toBe(2);
  });

  it("should not mark as completed if not all chunks dispatched", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
        { table: "users", id: "u3" },
      ],
      deleteHandleStr: "handle:partial",
      batchSize: 1,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, {
        status: "processing",
        // dispatchedChunkCount stays 0, totalChunkCount is 1
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1 }),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("processing");
    expect(status!.completedCount).toBe(1);
  });

  it("should mark job as failed when errors occur and not all targets were deleted", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
      ],
      deleteHandleStr: "handle:fail",
      batchSize: 100,
    });

    // Simulate: all chunks dispatched, but only 1 of 2 succeeded
    await t.run(async (ctx) => {
      const chunks = await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
      }
      await ctx.db.patch(jobId as any, {
        status: "processing",
        dispatchedChunkCount: 1,
      });
    });

    await t.mutation(api.lib.reportBatchComplete, {
      jobId,
      batchSummary: JSON.stringify({ users: 1 }),
      errors: JSON.stringify(["users:u2 - Document not found"]),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("failed");
    expect(status!.completedCount).toBe(1);
    expect(status!.error).toBeDefined();
    expect(JSON.parse(status!.error!)).toContain("users:u2 - Document not found");
  });

  it("should silently handle non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.reportBatchComplete, {
        jobId: "nonexistent_id_12345",
        batchSummary: JSON.stringify({ users: 1 }),
      })
    ).resolves.toBeNull();
  });
});

describe("cancelJob", () => {
  it("should throw error for non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.cancelJob, { jobId: "nonexistent_id_12345" })
    ).rejects.toThrow("not found");
  });

  it("should cancel a pending job and clean up chunks", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [
        { table: "users", id: "u1" },
        { table: "users", id: "u2" },
      ],
      deleteHandleStr: "handle:cancel",
      batchSize: 100,
    });

    await t.mutation(api.lib.cancelJob, { jobId });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("cancelled");

    // Chunks should be cleaned up
    const chunks = await t.run(async (ctx) => {
      return await ctx.db
        .query("deletionTargetChunks")
        .withIndex("by_job_chunk", (q: any) => q.eq("jobId", jobId as any))
        .collect();
    });
    expect(chunks).toHaveLength(0);
  });

  it("should no-op for already completed job", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:done",
      batchSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "completed" });
    });

    await t.mutation(api.lib.cancelJob, { jobId });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("completed"); // unchanged
  });
});

describe("startProcessing", () => {
  it("should throw error for non-existent job", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.startProcessing, { jobId: "nonexistent_id_12345" })
    ).rejects.toThrow("not found");
  });

  it("should throw error if job is not in pending state", async () => {
    const t = convexTest(schema, modules);

    const jobId = await t.mutation(api.lib.createBatchJob, {
      targets: [],
      deleteHandleStr: "handle:already",
      batchSize: 100,
    });

    // Manually transition to processing to test the guard
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId as any, { status: "processing" });
    });

    await expect(
      t.mutation(api.lib.startProcessing, { jobId })
    ).rejects.toThrow("not in pending state");
  });
});
