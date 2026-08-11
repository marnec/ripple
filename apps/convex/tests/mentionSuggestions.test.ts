import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/** Create a project with seeded statuses (mirrors projects.create logic). */
async function setupProjectWithStatuses(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; key?: string },
) {
  const { workspaceId, userId, key = "TST" } = opts;
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test Project",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key,
      taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 1,
      isDefault: false,
      isCompleted: true,
    });
    return { projectId, todoId, doneId };
  });
}

// Audit-log component schedules aggregate updates; fake timers keep them from
// firing mid-test and corrupting convex-test state (same as tasks.test.ts).
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("nodes.suggest", () => {
  it("returns only the resources whose name matches the typed query", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.documents.create, { workspaceId, name: "Q3 Roadmap" });
    await asUser.mutation(api.documents.create, { workspaceId, name: "Budget" });

    const results = await asUser.query(api.nodes.suggest, {
      workspaceId,
      types: ["document"],
      query: "roadmap",
    });

    expect(results.map((r) => r.name)).toEqual(["Q3 Roadmap"]);
  });

  it("browses the most recent resources when the picker opens with no query yet", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.documents.create, { workspaceId, name: "Oldest" });
    await asUser.mutation(api.documents.create, { workspaceId, name: "Middle" });
    await asUser.mutation(api.documents.create, { workspaceId, name: "Newest" });

    const results = await asUser.query(api.nodes.suggest, {
      workspaceId,
      types: ["document"],
      perType: 2,
    });

    expect(results.map((r) => r.name)).toEqual(["Newest", "Middle"]);
  });

  it("never suggests another workspace's resources, even to its admin", async () => {
    const t = createTestContext();
    const a = await setupWorkspaceWithAdmin(t, "Workspace A");
    const b = await setupWorkspaceWithAdmin(t, "Workspace B");

    await b.asUser.mutation(api.documents.create, {
      workspaceId: b.workspaceId,
      name: "Secret Roadmap",
    });

    // A's admin can't reach into B by naming B's id…
    const probe = await a.asUser.query(api.nodes.suggest, {
      workspaceId: b.workspaceId,
      types: ["document"],
      query: "roadmap",
    });
    expect(probe).toEqual([]);

    // …and B's rows don't bleed into A's own suggestions.
    const own = await a.asUser.query(api.nodes.suggest, {
      workspaceId: a.workspaceId,
      types: ["document"],
    });
    expect(own).toEqual([]);
  });
});

describe("tasks.suggest", () => {
  it("offers matching open tasks with the fields the picker renders, and hides completed ones", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId, doneId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Fix login redirect",
      statusId: todoId,
      priority: "medium",
    });
    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Fix logout redirect",
      statusId: doneId,
      priority: "medium",
    });

    const results = await asUser.query(api.tasks.suggest, { workspaceId, query: "fix" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Fix login redirect",
      statusColor: "bg-gray-500",
      projectKey: "TST",
      number: 1,
    });
  });
});

describe("tasks.suggest — dependency picker", () => {
  it("includes completed tasks when asked, so a task can depend on finished work", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId, doneId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Ship migration",
      statusId: doneId,
      priority: "medium",
    });
    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Ship dashboard",
      statusId: todoId,
      priority: "medium",
    });

    const results = await asUser.query(api.tasks.suggest, {
      workspaceId,
      query: "ship",
      includeCompleted: true,
    });

    expect(results.map((r) => r.title).sort()).toEqual(["Ship dashboard", "Ship migration"]);
  });
});

// The `#` picker was the only consumer of the four resource lists the sidebar
// query used to collect in full (the four SelectorList components take the prop
// and never render it, and the breadcrumb falls back to
// `breadcrumb.getResourceNames`). With the picker on `nodes.suggest`, the
// always-mounted app-shell subscription stops reading those tables at all.
describe("workspaceSidebarData.get — payload scope", () => {
  it("does not grow with the workspace's documents, diagrams, spreadsheets or projects", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

    const before = await asUser.query(api.workspaceSidebarData.get, { workspaceId });

    await t.run(async (ctx) => {
      await ctx.db.insert("documents", { workspaceId, name: "Doc" });
      await ctx.db.insert("diagrams", { workspaceId, name: "Diagram" });
      await ctx.db.insert("spreadsheets", { workspaceId, name: "Sheet" });
      await ctx.db.insert("projects", {
        workspaceId,
        name: "Project",
        color: "bg-blue-500",
        creatorId: userId,
      });
    });

    const after = await asUser.query(api.workspaceSidebarData.get, { workspaceId });

    expect(after).toEqual(before);
  });
});
