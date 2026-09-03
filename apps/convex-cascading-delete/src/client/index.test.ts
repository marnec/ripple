/*
(1.) Test suite for CascadingDelete client API and utility functions
(2.) Validates inline deletion traversal, cycle detection, and batch coordination
(3.) Uses mock database context to simulate Convex query and mutation patterns

This test suite exercises the CascadingDelete class which serves as the primary
interface for applications using the component. It tests the core deletion algorithms
including depth-first post-order traversal, visited-set cycle detection, and the
batch coordination logic that bridges app-side deletion with component-side job
management. Mock database contexts simulate the Convex query builder pattern
(query → withIndex → collect) to verify correct traversal and deletion ordering
without requiring a full Convex runtime environment.
*/

import { describe, it, expect, vi } from "vitest";
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import type { CascadeConfig } from "../component/types.js";

vi.mock("convex/server", async () => {
  const actual: any = await vi.importActual("convex/server");
  return {
    ...actual,
    createFunctionHandle: vi.fn(async () => "mock-function-handle"),
  };
});

const { CascadingDelete, makeBatchDeleteHandler } = await import("./index.js");

/**
 * Creates a mock database context that simulates Convex's query builder pattern.
 * Supports query → withIndex → collect chain with field-based filtering.
 */
function createMockDb(tables: Record<string, any[]>) {
  const deleted: string[] = [];
  const deletedSet = new Set<string>();

  return {
    query: (table: string) => ({
      withIndex: (_indexName: string, fn: (q: any) => any) => {
        let filterField: string | null = null;
        let filterValue: string | null = null;

        const queryBuilder: any = {
          eq: (field: string, value: string) => {
            filterField = field;
            filterValue = value;
            return queryBuilder;
          },
        };

        fn(queryBuilder);

        return {
          take: async (n: number) => {
            const docs = tables[table] || [];
            return docs
              .filter(
                (d) =>
                  !deletedSet.has(d._id) &&
                  (!filterField || d[filterField!] === filterValue)
              )
              .slice(0, n);
          },
          collect: async () => {
            const docs = tables[table] || [];
            if (filterField && filterValue) {
              return docs.filter(
                (d) =>
                  !deletedSet.has(d._id) &&
                  d[filterField!] === filterValue
              );
            }
            return docs.filter((d) => !deletedSet.has(d._id));
          },
          first: async () => {
            const docs = tables[table] || [];
            if (filterField && filterValue) {
              return (
                docs.find(
                  (d) =>
                    !deletedSet.has(d._id) &&
                    d[filterField!] === filterValue
                ) || null
              );
            }
            return docs.find((d) => !deletedSet.has(d._id)) || null;
          },
        };
      },
    }),
    delete: async (id: string) => {
      if (deletedSet.has(id)) {
        throw new Error(`Document ${id} already deleted`);
      }
      deletedSet.add(id);
      deleted.push(id);
    },
    get: async (id: string) => {
      if (deletedSet.has(id)) return null;
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d) => d._id === id);
        if (doc) return doc;
      }
      return null;
    },
    patch: async (id: string, fields: Record<string, any>) => {
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d) => d._id === id);
        if (doc) Object.assign(doc, fields);
      }
    },
    _deleted: deleted,
    _deletedSet: deletedSet,
  };
}

/**
 * Members of the client's `MutationCtx` that these tests never exercise. They
 * are present so the double satisfies the type, and they throw rather than
 * return `undefined` so that a code path which starts using one fails here,
 * loudly, instead of silently reading nothing.
 */
function unimplemented(name: string) {
  return () => {
    throw new Error(`mock ctx: ${name} is not implemented`);
  };
}

function createMockCtx(db: any) {
  return {
    db,
    runMutation: vi.fn(async () => "mock-job-id"),
    runQuery: vi.fn(),
    scheduler: {
      runAfter: vi.fn(),
      runAt: vi.fn(),
      cancel: vi.fn(),
    },
    // `deleteWithCascade` and friends take the full `MutationCtx`, which
    // includes `storage`; nothing in the cascade path touches it. The cast
    // covers `StorageWriter`'s overloads, which plain stubs cannot match
    // structurally.
    storage: {
      getUrl: unimplemented("storage.getUrl"),
      generateUploadUrl: unimplemented("storage.generateUploadUrl"),
      delete: unimplemented("storage.delete"),
      getMetadata: unimplemented("storage.getMetadata"),
    } as unknown as GenericMutationCtx<GenericDataModel>["storage"],
  };
}

const noopComponent: any = {
  lib: {
    createJob: "component.lib.createJob",
    loadJob: "component.lib.loadJob",
    saveStep: "component.lib.saveStep",
    cancelJob: "component.lib.cancelJob",
    getJobStatus: "component.lib.getJobStatus",
  },
};

describe("CascadingDelete", () => {
  describe("constructor", () => {
    it("should store rules from options", () => {
      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };

      const cd = new CascadingDelete(noopComponent, { rules });
      expect(cd).toBeDefined();
    });
  });

  describe("deleteWithCascade", () => {
    it("should delete a single document with no cascade rules", async () => {
      const db = createMockDb({});
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules: {} });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      expect(summary).toEqual({ users: 1 });
      expect(db._deleted).toEqual(["user1"]);
    });

    it("should cascade to direct dependents", async () => {
      const db = createMockDb({
        posts: [
          { _id: "post1", authorId: "user1", title: "First" },
          { _id: "post2", authorId: "user1", title: "Second" },
          { _id: "post3", authorId: "user2", title: "Other" },
        ],
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      expect(summary).toEqual({ users: 1, posts: 2 });
      expect(db._deleted).toContain("post1");
      expect(db._deleted).toContain("post2");
      expect(db._deleted).toContain("user1");
      expect(db._deleted).not.toContain("post3");
    });

    it("should cascade through multiple levels", async () => {
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
        comments: [
          { _id: "comment1", postId: "post1" },
          { _id: "comment2", postId: "post1" },
        ],
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
        posts: [{ to: "comments", via: "by_post", field: "postId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      expect(summary).toEqual({ users: 1, posts: 1, comments: 2 });
      expect(db._deleted).toHaveLength(4);
    });

    it("should use post-order deletion (children before parents)", async () => {
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
        comments: [{ _id: "comment1", postId: "post1" }],
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
        posts: [{ to: "comments", via: "by_post", field: "postId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      await cd.deleteWithCascade(ctx, "users", "user1");

      // Post-order: deepest children first
      expect(db._deleted.indexOf("comment1")).toBeLessThan(
        db._deleted.indexOf("post1")
      );
      expect(db._deleted.indexOf("post1")).toBeLessThan(
        db._deleted.indexOf("user1")
      );
    });

    it("should handle branching cascades (multiple rules per table)", async () => {
      const db = createMockDb({
        members: [
          { _id: "m1", teamId: "team1" },
          { _id: "m2", teamId: "team1" },
        ],
        projects: [{ _id: "proj1", teamId: "team1" }],
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        teams: [
          { to: "members", via: "byTeamId", field: "teamId" },
          { to: "projects", via: "byTeamId", field: "teamId" },
        ],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "teams", "team1");

      expect(summary).toEqual({ teams: 1, members: 2, projects: 1 });
      expect(db._deleted).toHaveLength(4);
    });

    it("should detect cycles and avoid infinite recursion", async () => {
      // Simulate a scenario where A references B and B references A
      const db = createMockDb({
        tableB: [{ _id: "b1", refA: "a1" }],
        tableA: [{ _id: "a1", refB: "b1" }],
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        tableA: [{ to: "tableB", via: "byRefA", field: "refA" }],
        tableB: [{ to: "tableA", via: "byRefB", field: "refB" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      // Should not hang or throw - visited set prevents infinite recursion
      const summary = await cd.deleteWithCascade(ctx, "tableA", "a1");

      expect(summary.tableA).toBe(1);
      expect(summary.tableB).toBe(1);
    });

    it("should handle no dependents found", async () => {
      const db = createMockDb({
        posts: [], // No posts exist
      });
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      expect(summary).toEqual({ users: 1 });
      expect(db._deleted).toEqual(["user1"]);
    });

    it("should handle already-deleted documents gracefully", async () => {
      const db = createMockDb({});
      // Pre-delete the document
      db._deletedSet.add("user1");
      const ctx = createMockCtx(db);

      const cd = new CascadingDelete(noopComponent, { rules: {} });

      // Should not throw - catch block handles already-deleted
      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // Summary won't include the already-deleted doc since delete throws
      expect(summary.users).toBeUndefined();
    });
  });

  describe("deleteWithCascadeBatched", () => {
    const rules: CascadeConfig = {
      users: [{ to: "posts", via: "by_author", field: "authorId" }],
      posts: [{ to: "comments", via: "by_post", field: "postId" }],
    };
    const batchHandlerRef = "mockRef" as any;

    function smallTree() {
      return createMockDb({
        users: [{ _id: "user1", name: "Alice" }],
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
        ],
        comments: [
          { _id: "c1", postId: "post1" },
          { _id: "c2", postId: "post1" },
        ],
      });
    }

    it("finishes inline when the tree fits one budget, and fires onComplete", async () => {
      const db = smallTree();
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules });

      const result = await cd.deleteWithCascadeBatched(ctx, "users", "user1", {
        batchHandlerRef,
        onComplete: "onCompleteRef" as any,
        onCompleteContext: { actor: "u9" },
      });

      expect(result.jobId).toBeNull();
      expect(result.initialSummary).toEqual({ users: 1, posts: 2, comments: 2 });
      expect(db._deleted).toHaveLength(5);
      expect(ctx.runMutation).not.toHaveBeenCalled();
      expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, "mock-function-handle", {
        summary: JSON.stringify({ users: 1, posts: 2, comments: 2 }),
        status: "completed",
        context: JSON.stringify({ actor: "u9" }),
      });
    });

    it("deletes a parent before its dependents (pre-order)", async () => {
      const db = smallTree();
      const cd = new CascadingDelete(noopComponent, { rules });

      await cd.deleteWithCascadeBatched(createMockCtx(db), "users", "user1", { batchHandlerRef });

      const order = (id: string) => db._deleted.indexOf(id);
      expect(order("user1")).toBe(0);
      expect(order("post1")).toBeLessThan(order("c1"));
      expect(order("post1")).toBeLessThan(order("c2"));
    });

    it("hands the frontier to the component when the delete budget runs out", async () => {
      const db = createMockDb({
        users: [{ _id: "user1" }],
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
          { _id: "post3", authorId: "user1" },
        ],
      });
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules });

      const result = await cd.deleteWithCascadeBatched(ctx, "users", "user1", {
        batchHandlerRef,
        batchSize: 2,
        onComplete: "onCompleteRef" as any,
      });

      // The root plus one budget's worth, nothing more, in this transaction.
      expect(db._deleted).toEqual(["user1", "post1", "post2"]);
      expect(result).toEqual({ jobId: "mock-job-id", initialSummary: { users: 1, posts: 2 } });
      // onComplete is the component's to fire now, not ours.
      expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();

      expect(ctx.runMutation).toHaveBeenCalledTimes(1);
      const [ref, args] = (ctx.runMutation as any).mock.calls[0];
      expect(ref).toBe(noopComponent.lib.createJob);
      expect(args).toEqual({
        // The parent stays on the frontier with its page probe; the two posts
        // it just deleted sit above it, waiting to be expanded first (LIFO).
        frontier: [
          { table: "users", id: "user1", ruleIndex: 0, probeId: "post1" },
          { table: "posts", id: "post1", ruleIndex: 0 },
          { table: "posts", id: "post2", ruleIndex: 0 },
        ],
        failedIds: [],
        batchSummary: JSON.stringify({ users: 1, posts: 2 }),
        errors: undefined,
        deleteHandleStr: "mock-function-handle",
        batchSize: 2,
        maxReadsPerBatch: 1024,
        onCompleteHandleStr: "mock-function-handle",
        onCompleteContext: undefined,
      });
    });

    it("stops when the read budget runs out, however few rows it deleted", async () => {
      const db = smallTree();
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules });

      // One read for the root, one for the posts page — then nothing left
      // for the comments.
      const result = await cd.deleteWithCascadeBatched(ctx, "users", "user1", {
        batchHandlerRef,
        maxReadsPerBatch: 2,
      });

      expect(result.jobId).toBe("mock-job-id");
      expect(db._deleted).toEqual(["user1", "post1", "post2"]);
      const [, args] = (ctx.runMutation as any).mock.calls[0];
      expect(args.frontier.map((e: any) => e.id)).toEqual(["user1", "post1", "post2"]);
    });

    it("passes the fetched document to custom deleters", async () => {
      const db = smallTree();
      const seen: Array<{ id: string; doc: any }> = [];
      const cd = new CascadingDelete(noopComponent, {
        rules,
        deleters: {
          posts: async (ctx: any, id: string, doc: any) => {
            seen.push({ id, doc });
            await ctx.db.delete(id);
          },
        },
      });

      await cd.deleteWithCascadeBatched(createMockCtx(db), "users", "user1", { batchHandlerRef });

      expect(seen).toEqual([
        { id: "post1", doc: { _id: "post1", authorId: "user1" } },
        { id: "post2", doc: { _id: "post2", authorId: "user1" } },
      ]);
      expect(db._deleted).toContain("c1");
    });

    it("skips a row that cannot be deleted, reports it, and still completes", async () => {
      const db = createMockDb({
        users: [{ _id: "user1" }],
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
          { _id: "post3", authorId: "user1" },
        ],
        comments: [
          { _id: "c1", postId: "post1" },
          { _id: "c2", postId: "post2" },
          { _id: "c3", postId: "post3" },
        ],
      });
      const rawDelete = db.delete;
      db.delete = async (id: string) => {
        if (id === "post2") throw new Error("write conflict");
        await rawDelete(id);
      };
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules });

      const result = await cd.deleteWithCascadeBatched(ctx, "users", "user1", {
        batchHandlerRef,
        onComplete: "onCompleteRef" as any,
      });

      // Terminated — the undeletable row did not keep the page from moving.
      expect(result.jobId).toBeNull();
      expect(db._deleted).toEqual(expect.arrayContaining(["user1", "post1", "post3", "c1", "c3"]));
      expect(db._deleted).not.toContain("post2");
      // Its subtree is left for reconciliation rather than walked.
      expect(db._deleted).not.toContain("c2");
      expect(result.initialSummary).toEqual({ users: 1, posts: 2, comments: 2 });
      expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
        0,
        "mock-function-handle",
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("detects a deleter that leaves the row in place instead of refetching it forever", async () => {
      const db = createMockDb({
        users: [{ _id: "user1" }],
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
        ],
      });
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, {
        rules,
        deleters: { posts: async () => {} },
      });

      const result = await cd.deleteWithCascadeBatched(ctx, "users", "user1", {
        batchHandlerRef,
        onComplete: "onCompleteRef" as any,
      });

      expect(result.jobId).toBeNull();
      expect(db._deleted).toEqual(["user1"]);
      expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
        0,
        "mock-function-handle",
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("does not loop on cycles — a deleted row cannot be fetched again", async () => {
      const db = createMockDb({
        tableB: [{ _id: "b1", refA: "a1" }],
        tableA: [{ _id: "a1", refB: "b1" }],
      });
      const cd = new CascadingDelete(noopComponent, {
        rules: {
          tableA: [{ to: "tableB", via: "byRefA", field: "refA" }],
          tableB: [{ to: "tableA", via: "byRefB", field: "refB" }],
        },
      });

      const result = await cd.deleteWithCascadeBatched(createMockCtx(db), "tableA", "a1", {
        batchHandlerRef,
      });

      expect(result).toEqual({ jobId: null, initialSummary: { tableA: 1, tableB: 1 } });
    });

    it("is a no-op for a root that no longer exists", async () => {
      const db = createMockDb({ posts: [{ _id: "post1", authorId: "ghost" }] });
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules });

      const result = await cd.deleteWithCascadeBatched(ctx, "users", "ghost", { batchHandlerRef });

      expect(result).toEqual({ jobId: null, initialSummary: {} });
      expect(db._deleted).toHaveLength(0);
    });

    it("rejects rules with softDeleteField", async () => {
      const cd = new CascadingDelete(noopComponent, {
        rules: {
          users: [{ to: "posts", via: "by_author", field: "authorId", softDeleteField: "deletedAt" }],
        },
      });

      await expect(
        cd.deleteWithCascadeBatched(createMockCtx(createMockDb({})), "users", "user1", {
          batchHandlerRef,
        }),
      ).rejects.toThrow(/softDeleteField/);
    });
  });

  describe("makeBatchDeleteHandler", () => {
    const rules: CascadeConfig = {
      users: [{ to: "posts", via: "by_author", field: "authorId" }],
      posts: [{ to: "comments", via: "by_post", field: "postId" }],
    };

    type Job = {
      frontier: any[];
      failedIds: string[];
      batchSize: number;
      maxReadsPerBatch: number;
    };

    /**
     * Stands in for the component: `loadJob` serves the job, `saveStep`
     * records what the step reported. Returns the ctx and the recorded saves.
     */
    function stepCtx(db: any, job: Job | null) {
      const saves: any[] = [];
      const ctx = {
        ...createMockCtx(db),
        runQuery: vi.fn(async (ref: any) => (ref === noopComponent.lib.loadJob ? job : null)),
        runMutation: vi.fn(async (ref: any, args: any) => {
          if (ref === noopComponent.lib.saveStep) saves.push(args);
          return null;
        }),
      };
      return { ctx, saves };
    }

    function makeStep(cd: InstanceType<typeof CascadingDelete>) {
      const def = makeBatchDeleteHandler((d: any) => d, cd);
      return (ctx: any, jobId: string) => def.handler(ctx, { jobId });
    }

    it("stands down when the job is gone or no longer processing", async () => {
      const db = createMockDb({ posts: [{ _id: "post1", authorId: "user1" }] });
      const { ctx, saves } = stepCtx(db, null);
      const step = makeStep(new CascadingDelete(noopComponent, { rules }));

      await step(ctx, "job1");

      expect(db._deleted).toHaveLength(0);
      expect(saves).toHaveLength(0);
    });

    it("runs one budgeted step from the persisted frontier and reports it", async () => {
      const db = createMockDb({
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
          { _id: "post3", authorId: "user1" },
        ],
      });
      const { ctx, saves } = stepCtx(db, {
        frontier: [{ table: "users", id: "user1", ruleIndex: 0 }],
        failedIds: [],
        batchSize: 2,
        maxReadsPerBatch: 100,
      });
      const step = makeStep(new CascadingDelete(noopComponent, { rules }));

      await step(ctx, "job1");

      expect(db._deleted).toEqual(["post1", "post2"]);
      expect(saves).toEqual([
        {
          jobId: "job1",
          frontier: [
            { table: "users", id: "user1", ruleIndex: 0, probeId: "post1" },
            { table: "posts", id: "post1", ruleIndex: 0 },
            { table: "posts", id: "post2", ruleIndex: 0 },
          ],
          failedIds: [],
          batchSummary: JSON.stringify({ posts: 2 }),
          errors: undefined,
          done: false,
        },
      ]);
    });

    it("honours the persisted skip-set", async () => {
      const db = createMockDb({
        posts: [
          { _id: "post1", authorId: "user1" },
          { _id: "post2", authorId: "user1" },
        ],
      });
      const { ctx, saves } = stepCtx(db, {
        frontier: [{ table: "users", id: "user1", ruleIndex: 0 }],
        failedIds: ["post1"],
        batchSize: 100,
        maxReadsPerBatch: 100,
      });
      const step = makeStep(new CascadingDelete(noopComponent, { rules }));

      await step(ctx, "job1");

      expect(db._deleted).toEqual(["post2"]);
      expect(saves[0]).toMatchObject({ failedIds: ["post1"], done: true, frontier: [] });
    });

    it("drains a tree across steps until the frontier is empty", async () => {
      const posts = Array.from({ length: 5 }, (_, i) => ({ _id: `post${i}`, authorId: "user1" }));
      const comments = posts.flatMap((p) =>
        Array.from({ length: 3 }, (_, j) => ({ _id: `${p._id}-c${j}`, postId: p._id })),
      );
      const db = createMockDb({ posts, comments });
      const cd = new CascadingDelete(noopComponent, { rules });
      const step = makeStep(cd);

      // A minimal component: the job lives here, saveStep advances it.
      let job: Job & { done: boolean } = {
        frontier: [{ table: "users", id: "user1", ruleIndex: 0 }],
        failedIds: [],
        batchSize: 4,
        maxReadsPerBatch: 100,
        done: false,
      };
      const ctx = {
        ...createMockCtx(db),
        runQuery: vi.fn(async () => (job.done ? null : { ...job, frontier: structuredClone(job.frontier) })),
        runMutation: vi.fn(async (_ref: any, args: any) => {
          job = { ...job, frontier: args.frontier, failedIds: args.failedIds, done: args.done };
          return null;
        }),
      };

      let steps = 0;
      while (!job.done) {
        await step(ctx, "job1");
        steps++;
        if (steps > 50) throw new Error("cascade did not terminate");
      }

      expect(steps).toBeGreaterThan(1);
      expect(db._deleted).toHaveLength(posts.length + comments.length);
      expect(job.frontier).toEqual([]);
    });
  });

  describe("patchDb", () => {
    it("should throw when delete is called on patched db", () => {
      const cd = new CascadingDelete(noopComponent, { rules: {} });
      const db = { delete: () => {}, query: () => {} };
      const patched = cd.patchDb(db);

      expect(() => patched.delete("id")).toThrow(
        "Direct db.delete() is disabled"
      );
    });

    it("should allow non-delete operations on patched db", () => {
      const cd = new CascadingDelete(noopComponent, { rules: {} });
      const mockQuery = vi.fn().mockReturnValue("result");
      const db = { delete: () => {}, query: mockQuery, get: vi.fn() };
      const patched = cd.patchDb(db);

      patched.query("users");
      expect(mockQuery).toHaveBeenCalledWith("users");

      patched.get("id");
      expect(db.get).toHaveBeenCalledWith("id");
    });
  });

  describe("validateRules", () => {
    it("should succeed when indexes exist", async () => {
      const db = createMockDb({
        posts: [],
      });
      const ctx = { db };

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      await expect(cd.validateRules(ctx)).resolves.toBeUndefined();
    });

    it("should throw when index query fails", async () => {
      const db = {
        query: () => ({
          withIndex: () => ({
            first: async () => {
              throw new Error("Index not found");
            },
          }),
        }),
      };
      const ctx = { db };

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "nonexistent_index", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      await expect(cd.validateRules(ctx)).rejects.toThrow(
        "Cascade validation failed"
      );
    });
  });

  describe("custom deleters", () => {
    it("should call custom deleter instead of db.delete for matched table", async () => {
      const db = createMockDb({});
      const ctx = createMockCtx(db);
      const deleterCalls: Array<{ id: string; doc: any }> = [];

      // Add a doc so db.get returns it
      (db as any).get = async (id: string) => ({ _id: id, name: "Test User" });

      const rules: CascadeConfig = {};
      const cd = new CascadingDelete(noopComponent, {
        rules,
        deleters: {
          users: async (_ctx: any, id: string, doc: any) => {
            deleterCalls.push({ id, doc });
            await _ctx.db.delete(id);
          },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      expect(summary).toEqual({ users: 1 });
      expect(deleterCalls).toHaveLength(1);
      expect(deleterCalls[0].id).toBe("user1");
      expect(deleterCalls[0].doc).toEqual({ _id: "user1", name: "Test User" });
    });

    it("should use db.delete for tables without custom deleter", async () => {
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
      });
      const ctx = createMockCtx(db);

      (db as any).get = async (id: string) => ({ _id: id });

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, {
        rules,
        deleters: {
          users: async (_ctx: any, id: string, _doc: any) => {
            await _ctx.db.delete(id);
          },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // posts deleted via db.delete (no custom deleter), users via custom deleter
      expect(summary).toEqual({ users: 1, posts: 1 });
      expect(db._deleted).toContain("post1");
      expect(db._deleted).toContain("user1");
    });

    it("should skip deletion when custom deleter receives null doc", async () => {
      const db = createMockDb({});
      const ctx = createMockCtx(db);
      const deleterCalls: string[] = [];

      // db.get returns null (doc already deleted)
      (db as any).get = async () => null;

      const cd = new CascadingDelete(noopComponent, {
        rules: {},
        deleters: {
          users: async (_ctx: any, id: string, _doc: any) => {
            deleterCalls.push(id);
          },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // Should not count or call deleter when doc is null
      expect(summary.users).toBeUndefined();
      expect(deleterCalls).toHaveLength(0);
    });

    it("should fall back to raw db.delete when custom deleter throws", async () => {
      const db = createMockDb({});
      const ctx = createMockCtx(db);

      (db as any).get = async (id: string) => ({ _id: id, name: "User" });

      const cd = new CascadingDelete(noopComponent, {
        rules: {},
        deleters: {
          users: async () => {
            throw new Error("DELETE_MISSING_KEY: aggregate entry not found");
          },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // Should still succeed via raw delete fallback
      expect(summary).toEqual({ users: 1 });
      expect(db._deleted).toContain("user1");
    });

    it("should cascade children even when parent deleter throws", async () => {
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
      });
      const ctx = createMockCtx(db);

      (db as any).get = async (id: string) => ({ _id: id });

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, {
        rules,
        deleters: {
          users: async () => {
            throw new Error("Trigger failed");
          },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // Children deleted normally, parent via fallback
      expect(summary).toEqual({ users: 1, posts: 1 });
      expect(db._deleted).toContain("post1");
      expect(db._deleted).toContain("user1");
    });

    it("siblings of a failing node are all deleted", async () => {
      // project → task1 (OK), task2 (FAILS), task3 (OK)
      const db = createMockDb({
        tasks: [
          { _id: "task1", projectId: "proj1" },
          { _id: "task2", projectId: "proj1" },
          { _id: "task3", projectId: "proj1" },
        ],
      });
      const ctx = createMockCtx(db);
      (db as any).get = async (id: string) => ({ _id: id });

      const cd = new CascadingDelete(noopComponent, {
        rules: {
          projects: [{ to: "tasks", via: "by_project", field: "projectId" }],
        },
        deleters: {
          tasks: async (_ctx: any, id: string) => {
            if (id === "task2") throw new Error("Missing aggregate key");
            await _ctx.db.delete(id);
          },
          projects: async (_ctx: any, id: string) => { await _ctx.db.delete(id); },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "projects", "proj1");

      expect(summary).toEqual({ projects: 1, tasks: 3 });
      expect(db._deleted).toContain("task1");
      expect(db._deleted).toContain("task2"); // fallback raw delete
      expect(db._deleted).toContain("task3");
      expect(db._deleted).toContain("proj1");
    });

    it("children of a failing node are deleted before the fallback", async () => {
      // project → task (FAILS) → comment1, comment2
      const db = createMockDb({
        tasks: [{ _id: "task1", projectId: "proj1" }],
        comments: [
          { _id: "c1", taskId: "task1" },
          { _id: "c2", taskId: "task1" },
        ],
      });
      const ctx = createMockCtx(db);
      (db as any).get = async (id: string) => ({ _id: id });

      const cd = new CascadingDelete(noopComponent, {
        rules: {
          projects: [{ to: "tasks", via: "by_project", field: "projectId" }],
          tasks: [{ to: "comments", via: "by_task", field: "taskId" }],
        },
        deleters: {
          tasks: async () => { throw new Error("Aggregate missing"); },
          projects: async (_ctx: any, id: string) => { await _ctx.db.delete(id); },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "projects", "proj1");

      expect(summary).toEqual({ projects: 1, tasks: 1, comments: 2 });
      // Comments deleted before task (post-order)
      expect(db._deleted.indexOf("c1")).toBeLessThan(db._deleted.indexOf("task1"));
      expect(db._deleted.indexOf("c2")).toBeLessThan(db._deleted.indexOf("task1"));
      expect(db._deleted).toContain("proj1");
    });

    it("mixed: some siblings fail, their children still cascade, healthy siblings unaffected", async () => {
      // project → task1 (OK, has comment1), task2 (FAILS, has comment2, comment3), task3 (OK)
      const db = createMockDb({
        tasks: [
          { _id: "task1", projectId: "proj1" },
          { _id: "task2", projectId: "proj1" },
          { _id: "task3", projectId: "proj1" },
        ],
        comments: [
          { _id: "c1", taskId: "task1" },
          { _id: "c2", taskId: "task2" },
          { _id: "c3", taskId: "task2" },
        ],
      });
      const ctx = createMockCtx(db);
      (db as any).get = async (id: string) => ({ _id: id });

      const cd = new CascadingDelete(noopComponent, {
        rules: {
          projects: [{ to: "tasks", via: "by_project", field: "projectId" }],
          tasks: [{ to: "comments", via: "by_task", field: "taskId" }],
        },
        deleters: {
          tasks: async (_ctx: any, id: string) => {
            if (id === "task2") throw new Error("Missing key");
            await _ctx.db.delete(id);
          },
          projects: async (_ctx: any, id: string) => { await _ctx.db.delete(id); },
        },
      });

      const summary = await cd.deleteWithCascade(ctx, "projects", "proj1");

      expect(summary).toEqual({ projects: 1, tasks: 3, comments: 3 });
      // All documents deleted
      expect(db._deleted).toHaveLength(7);
      for (const id of ["task1", "task2", "task3", "c1", "c2", "c3", "proj1"]) {
        expect(db._deleted).toContain(id);
      }
      // Post-order: all comments before their parent tasks
      expect(db._deleted.indexOf("c1")).toBeLessThan(db._deleted.indexOf("task1"));
      expect(db._deleted.indexOf("c2")).toBeLessThan(db._deleted.indexOf("task2"));
      expect(db._deleted.indexOf("c3")).toBeLessThan(db._deleted.indexOf("task2"));
    });
  });

  describe("soft delete", () => {
    it("should patch with softDeleteField instead of deleting dependents", async () => {
      const patchCalls: Array<{ id: string; fields: any }> = [];
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
      });
      (db as any).patch = async (id: string, fields: any) => {
        patchCalls.push({ id, fields });
      };
      const ctx = createMockCtx(db);

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId", softDeleteField: "deletedAt" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");

      // posts should be soft-deleted (patched), user hard-deleted
      expect(summary).toEqual({ users: 1, posts: 1 });
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0].id).toBe("post1");
      expect(patchCalls[0].fields.deletedAt).toBeTypeOf("number");
      // user1 should be hard-deleted (no softDeleteField on root)
      expect(db._deleted).toContain("user1");
      expect(db._deleted).not.toContain("post1");
    });
  });

  describe("onComplete callback", () => {
    it("should call onComplete with summary after inline cascade", async () => {
      const db = createMockDb({
        posts: [{ _id: "post1", authorId: "user1" }],
      });
      const ctx = createMockCtx(db);
      let completeSummary: any = null;

      const rules: CascadeConfig = {
        users: [{ to: "posts", via: "by_author", field: "authorId" }],
      };
      const cd = new CascadingDelete(noopComponent, { rules });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1", {
        onComplete: async (_ctx: any, s: any) => {
          completeSummary = s;
        },
      });

      expect(completeSummary).toEqual(summary);
      expect(completeSummary).toEqual({ users: 1, posts: 1 });
    });

    it("should not fail when onComplete is not provided", async () => {
      const db = createMockDb({});
      const ctx = createMockCtx(db);
      const cd = new CascadingDelete(noopComponent, { rules: {} });

      const summary = await cd.deleteWithCascade(ctx, "users", "user1");
      expect(summary).toEqual({ users: 1 });
    });
  });
});
