/*
(1.) Test suite for the component's cascade job lifecycle
(2.) Validates job creation, step persistence, finalization and cancellation
(3.) Uses convex-test to run against the real component schema

The component holds the state of a batched cascade between transactions: the
frontier, the skip-set of undeletable rows, the running summary. These tests
drive that state machine directly — createJob → loadJob → saveStep — the way
the app-side step handler does, and check the transitions: a step that is not
done reschedules, a done step finalizes and fires the completion callback,
errors mark the job failed, too many failed rows abort it, and a cancelled job
refuses further steps.
*/

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import type { FunctionArgs } from "convex/server";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { MAX_FAILED_IDS } from "./lib.js";

const modules = import.meta.glob("./**/*.ts");

// Tests pass fake handle strings (e.g. "handle:step") to ctx.scheduler.runAfter.
// convex-test fires those via setTimeout(0); if they're allowed to fire AFTER the
// next test's convexTest() replaces the global, their bookkeeping patches hit a
// stale DatabaseFake whose transaction was never opened, surfacing as
// "Write outside of transaction" unhandled rejections. Yielding here lets the
// queued setTimeouts complete against the current test's still-active global.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

const rootEntry = { table: "users", id: "user1", ruleIndex: 0 };

async function createJob(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<FunctionArgs<typeof api.lib.createJob>> = {},
) {
  return await t.mutation(api.lib.createJob, {
    frontier: [rootEntry],
    failedIds: [],
    batchSummary: JSON.stringify({ users: 1, posts: 3 }),
    deleteHandleStr: "handle:step",
    batchSize: 100,
    maxReadsPerBatch: 200,
    ...overrides,
  });
}

async function scheduled(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.system.query("_scheduled_functions").collect();
  });
}

describe("createJob", () => {
  it("stores the inline step's leftovers as a processing job and schedules the next step", async () => {
    const t = convexTest(schema, modules);

    const jobId = await createJob(t);

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toEqual({
      status: "processing",
      completedCount: 4,
      pendingCount: 1,
      stepCount: 1,
      completedSummary: JSON.stringify({ users: 1, posts: 3 }),
      error: undefined,
    });

    const job = await t.run(async (ctx) => await ctx.db.get(jobId as any));
    expect(job).toMatchObject({
      frontier: [rootEntry],
      failedIds: [],
      batchSize: 100,
      maxReadsPerBatch: 200,
      deleteHandleStr: "handle:step",
    });

    const jobs = await scheduled(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.args).toEqual([{ jobId }]);
  });

  it("keeps the inline step's errors", async () => {
    const t = convexTest(schema, modules);

    const jobId = await createJob(t, {
      failedIds: ["post9"],
      errors: JSON.stringify(["posts:post9 - boom"]),
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.error).toBe(JSON.stringify(["posts:post9 - boom"]));
  });

  it("refuses an empty frontier — that cascade already finished inline", async () => {
    const t = convexTest(schema, modules);
    await expect(createJob(t, { frontier: [] })).rejects.toThrow(/empty frontier/);
  });

  it("refuses a zero budget — a step could never make progress", async () => {
    const t = convexTest(schema, modules);
    await expect(createJob(t, { batchSize: 0 })).rejects.toThrow(/at least 1/);
    await expect(createJob(t, { maxReadsPerBatch: 0 })).rejects.toThrow(/at least 1/);
  });
});

describe("loadJob", () => {
  it("returns what a step needs for a processing job", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t, { failedIds: ["post9"] });

    expect(await t.query(api.lib.loadJob, { jobId })).toEqual({
      frontier: [rootEntry],
      failedIds: ["post9"],
      batchSize: 100,
      maxReadsPerBatch: 200,
    });
  });

  it("returns null for a missing, cancelled or finished job so the step stands down", async () => {
    const t = convexTest(schema, modules);

    expect(await t.query(api.lib.loadJob, { jobId: "nonexistent_id_12345" })).toBeNull();

    const cancelled = await createJob(t);
    await t.mutation(api.lib.cancelJob, { jobId: cancelled });
    expect(await t.query(api.lib.loadJob, { jobId: cancelled })).toBeNull();

    const finished = await createJob(t);
    await t.mutation(api.lib.saveStep, {
      jobId: finished,
      frontier: [],
      failedIds: [],
      batchSummary: "{}",
      done: true,
    });
    expect(await t.query(api.lib.loadJob, { jobId: finished })).toBeNull();
  });
});

describe("saveStep", () => {
  it("persists the new frontier, merges the summary and schedules the next step when not done", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t);

    const nextFrontier = [rootEntry, { table: "posts", id: "post4", ruleIndex: 1, probeId: "c1" }];
    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: nextFrontier,
      failedIds: [],
      batchSummary: JSON.stringify({ posts: 2, comments: 5 }),
      done: false,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toMatchObject({
      status: "processing",
      completedCount: 11,
      pendingCount: 2,
      stepCount: 2,
      completedSummary: JSON.stringify({ users: 1, posts: 5, comments: 5 }),
    });
    expect(await t.query(api.lib.loadJob, { jobId })).toMatchObject({ frontier: nextFrontier });

    // createJob's step plus this one.
    expect(await scheduled(t)).toHaveLength(2);
  });

  it("finalizes as completed and fires onComplete with the merged summary when done", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t, {
      onCompleteHandleStr: "handle:onComplete",
      onCompleteContext: JSON.stringify({ actor: "u1" }),
    });

    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [],
      failedIds: [],
      batchSummary: JSON.stringify({ posts: 2 }),
      done: true,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toMatchObject({
      status: "completed",
      completedCount: 6,
      pendingCount: 0,
      completedSummary: JSON.stringify({ users: 1, posts: 5 }),
    });
    expect(status!.error).toBeUndefined();

    const jobs = await scheduled(t);
    const onComplete = jobs.find((j) => j.args[0] && "summary" in (j.args[0] as object));
    expect(onComplete!.args).toEqual([
      {
        summary: JSON.stringify({ users: 1, posts: 5 }),
        status: "completed",
        context: JSON.stringify({ actor: "u1" }),
      },
    ]);
  });

  it("finalizes as failed when any step reported errors", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t, { onCompleteHandleStr: "handle:onComplete" });

    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [rootEntry],
      failedIds: ["post7"],
      batchSummary: JSON.stringify({ posts: 1 }),
      errors: JSON.stringify(["posts:post7 - boom"]),
      done: false,
    });
    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [],
      failedIds: ["post7"],
      batchSummary: JSON.stringify({ posts: 1 }),
      done: true,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toMatchObject({
      status: "failed",
      error: JSON.stringify(["posts:post7 - boom"]),
    });

    const jobs = await scheduled(t);
    const onComplete = jobs.find((j) => j.args[0] && "summary" in (j.args[0] as object));
    expect(onComplete!.args[0]).toMatchObject({ status: "failed" });
  });

  it("aborts as failed when more rows than the cap could not be deleted, even if the step is not done", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t);

    const failedIds = Array.from({ length: MAX_FAILED_IDS + 1 }, (_, i) => `post${i}`);
    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [rootEntry],
      failedIds,
      batchSummary: "{}",
      errors: JSON.stringify(failedIds.map((id) => `posts:${id} - boom`)),
      done: false,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("failed");
    const errors = JSON.parse(status!.error!) as string[];
    expect(errors[0]).toMatch(/could not be deleted/);
    // Bounded: the job document does not grow with the failure count.
    expect(errors.length).toBeLessThanOrEqual(65);
    expect(errors.at(-1)).toBe(`...and ${MAX_FAILED_IDS + 2 - 64} more`);

    // Only createJob's step is scheduled — the abort schedules nothing.
    expect(await scheduled(t)).toHaveLength(1);
  });

  it("ignores a step reported after the job was cancelled", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t);
    await t.mutation(api.lib.cancelJob, { jobId });

    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [],
      failedIds: [],
      batchSummary: JSON.stringify({ posts: 2 }),
      done: true,
    });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status).toMatchObject({ status: "cancelled", completedCount: 4 });
    expect(await scheduled(t)).toHaveLength(1);
  });

  it("silently handles a non-existent job", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.saveStep, {
        jobId: "nonexistent_id_12345",
        frontier: [],
        failedIds: [],
        batchSummary: "{}",
        done: true,
      }),
    ).resolves.toBeNull();
  });
});

describe("cancelJob", () => {
  it("throws for a non-existent job", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.cancelJob, { jobId: "nonexistent_id_12345" }),
    ).rejects.toThrow(/not found/);
  });

  it("cancels a processing job", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t);

    await t.mutation(api.lib.cancelJob, { jobId });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("cancelled");
  });

  it("no-ops for a job already in a terminal state", async () => {
    const t = convexTest(schema, modules);
    const jobId = await createJob(t);
    await t.mutation(api.lib.saveStep, {
      jobId,
      frontier: [],
      failedIds: [],
      batchSummary: "{}",
      done: true,
    });

    await t.mutation(api.lib.cancelJob, { jobId });

    const status = await t.query(api.lib.getJobStatus, { jobId });
    expect(status!.status).toBe("completed");
  });
});

describe("getJobStatus", () => {
  it("returns null for a non-existent job", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.lib.getJobStatus, { jobId: "nonexistent_id_12345" })).toBeNull();
  });
});
