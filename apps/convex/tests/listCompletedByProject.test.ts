import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

type Ctx = ReturnType<typeof createTestContext>;
type AsUser = Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"];

async function setupProject(t: Ctx, opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; name?: string; key?: string }) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: opts.name ?? "P", color: "bg-blue-500",
      workspaceId: opts.workspaceId, creatorId: opts.userId,
      key: opts.key ?? "P", taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0,
      isDefault: true, isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Done", color: "bg-green-500", order: 1,
      isDefault: false, isCompleted: true,
    });
    return { projectId, todoId, doneId };
  });
}

async function createCompleted(
  asUser: AsUser,
  workspaceId: Id<"workspaces">,
  projectId: Id<"projects">,
  doneId: Id<"taskStatuses">,
  args: {
    title: string;
    labels?: string[];
    assigneeId?: Id<"users">;
    priority?: "urgent" | "high" | "medium" | "low";
    dueDate?: string;
    plannedStartDate?: string;
  },
): Promise<Id<"tasks">> {
  const taskId = await asUser.mutation(api.tasks.create, {
    projectId, workspaceId,
    title: args.title,
    labels: args.labels,
    assigneeId: args.assigneeId,
    priority: args.priority,
    dueDate: args.dueDate,
    plannedStartDate: args.plannedStartDate,
  });
  await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });
  return taskId;
}

const PAGE_OPTS = { numItems: 50, cursor: null };

// ── Driver: no filter ────────────────────────────────────────────────

describe("listCompletedByProject — no filter", () => {
  it("returns only completed tasks (active excluded)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "active" });
    const c = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "done" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
    });
    expect(result.page.map((t) => t._id)).toEqual([c]);
  });

  it("default sort = created desc (natural index order)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const ids: Id<"tasks">[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await createCompleted(asUser, workspaceId, projectId, doneId, { title: `t-${i}` }));
    }
    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
    });
    expect(result.page.map((t) => t._id)).toEqual([...ids].reverse());
  });

  it("sort = dueDate desc orders by the due date column", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const a = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "a", dueDate: "2026-03-01" });
    const b = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "b", dueDate: "2026-05-01" });
    const c = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "c", dueDate: "2026-01-01" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS, sort: "dueDate",
    });
    expect(result.page.map((t) => t._id)).toEqual([b, a, c]);
  });

  it("sort = plannedStartDate desc orders by planned start date", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const a = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "a", plannedStartDate: "2026-03-01" });
    const b = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "b", plannedStartDate: "2026-05-01" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS, sort: "plannedStartDate",
    });
    expect(result.page.map((t) => t._id)).toEqual([b, a]);
  });
});

// ── Driver: tag ──────────────────────────────────────────────────────

describe("listCompletedByProject — tag filter", () => {
  it("returns only completed tasks tagged with the given name", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const tagged = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "x", labels: ["bug"] });
    await createCompleted(asUser, workspaceId, projectId, doneId, { title: "y" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "bug" },
    });
    expect(result.page.map((t) => t._id)).toEqual([tagged]);
  });

  it("tag + sort dueDate: ordered indexed scan via taskTags denormalized column", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const a = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "a", labels: ["bug"], dueDate: "2026-03-01" });
    const b = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "b", labels: ["bug"], dueDate: "2026-05-01" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "bug" }, sort: "dueDate",
    });
    expect(result.page.map((t) => t._id)).toEqual([b, a]);
  });

  it("returns empty for an unresolved tag name", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });
    await createCompleted(asUser, workspaceId, projectId, doneId, { title: "x", labels: ["bug"] });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "nonexistent" },
    });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  it("scopes to the requested project — does not return tasks from another project sharing the tag", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId: pA, doneId: doneA } = await setupProject(t, { workspaceId, userId, name: "A", key: "A" });
    const { projectId: pB, doneId: doneB } = await setupProject(t, { workspaceId, userId, name: "B", key: "B" });

    const inA = await createCompleted(asUser, workspaceId, pA, doneA, { title: "a", labels: ["shared"] });
    await createCompleted(asUser, workspaceId, pB, doneB, { title: "b", labels: ["shared"] });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId: pA, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "shared" },
    });
    expect(result.page.map((t) => t._id)).toEqual([inA]);
  });
});

// ── Driver: assignee ─────────────────────────────────────────────────

describe("listCompletedByProject — assignee filter", () => {
  it("returns only completed tasks assigned to the given user", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const mine = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "m", assigneeId: userId });
    await createCompleted(asUser, workspaceId, projectId, doneId, { title: "u" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "assignee", assigneeId: userId },
    });
    expect(result.page.map((t) => t._id)).toEqual([mine]);
  });

  it("assignee + sort dueDate uses the composite index", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const a = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "a", assigneeId: userId, dueDate: "2026-03-01" });
    const b = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "b", assigneeId: userId, dueDate: "2026-05-01" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "assignee", assigneeId: userId }, sort: "dueDate",
    });
    expect(result.page.map((t) => t._id)).toEqual([b, a]);
  });
});

// ── Driver: priority ─────────────────────────────────────────────────

describe("listCompletedByProject — priority filter", () => {
  it("returns only completed tasks with the given priority", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const urgent = await createCompleted(asUser, workspaceId, projectId, doneId, { title: "u", priority: "urgent" });
    await createCompleted(asUser, workspaceId, projectId, doneId, { title: "l", priority: "low" });

    const result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "priority", priority: "urgent" },
    });
    expect(result.page.map((t) => t._id)).toEqual([urgent]);
  });
});

// ── Pagination ───────────────────────────────────────────────────────

describe("listCompletedByProject — pagination", () => {
  it("paginates through completed tasks across multiple pages", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    for (let i = 0; i < 25; i++) {
      await createCompleted(asUser, workspaceId, projectId, doneId, { title: `t-${i}` });
    }

    const all: string[] = [];
    let cursor: string | null = null;
    let safety = 10;
    while (safety-- > 0) {
      const page: { page: { _id: string }[]; isDone: boolean; continueCursor: string } = await asUser.query(
        api.tasks.listCompletedByProject,
        { projectId, paginationOpts: { numItems: 10, cursor } },
      );
      all.push(...page.page.map((t) => t._id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(all).toHaveLength(25);
    expect(new Set(all).size).toBe(25);
  });
});

// ── Sync trigger: completion flip moves a task into / out of partitions ──

describe("listCompletedByProject — completion sync via trigger", () => {
  it("a task becomes visible/invisible on completion flip without re-running sync", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId, doneId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug"],
    });
    // Active by default → not visible in completed query.
    let result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "bug" },
    });
    expect(result.page).toEqual([]);

    // Flip to Done → completed=true → trigger updates taskTags.completed.
    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });
    result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "bug" },
    });
    expect(result.page.map((t) => t._id)).toEqual([taskId]);

    // Flip back to Todo → trigger removes from completed partition.
    await asUser.mutation(api.tasks.update, { taskId, statusId: todoId });
    result = await asUser.query(api.tasks.listCompletedByProject, {
      projectId, paginationOpts: PAGE_OPTS,
      filter: { kind: "tag", tagName: "bug" },
    });
    expect(result.page).toEqual([]);
  });
});
