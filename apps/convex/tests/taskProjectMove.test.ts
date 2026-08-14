import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { withTriggers } from "../convex/dbTriggers";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Moving a task between projects.
 *
 * No mutation exposes this today — `tasks.update` does not accept `projectId`
 * and nothing else patches it — so these tests drive the patch directly through
 * a trigger-aware writer. They exist because two consumers depend on the task
 * node staying in step with its task: `getEnrichedBacklinks` reads
 * `nodes.metadata.projectId`, and it is the cheap source of the workspace
 * graph's task -> project grouping. The invariant was previously true only by
 * accident of no write path existing; these pin it so that adding a "move task"
 * feature cannot quietly break either consumer.
 */

async function moveTask(
  t: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
  projectId: Id<"projects">,
) {
  await t.run(async (ctx) => {
    await withTriggers(ctx).db.patch(taskId, { projectId });
  });
}

function taskNode(t: ReturnType<typeof createTestContext>, taskId: Id<"tasks">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", taskId))
      .first(),
  );
}

function belongsToEdges(t: ReturnType<typeof createTestContext>, taskId: Id<"tasks">) {
  return t.run(async (ctx) =>
    (
      await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", taskId))
        .collect()
    ).filter((e) => e.edgeType === "belongs_to"),
  );
}

async function setup() {
  const t = createTestContext();
  const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  // Via the mutation, not `setupProject`: task statuses are seeded inline by
  // `projects.create`, and `tasks.create` needs a default status to exist.
  const from = await asUser.mutation(api.projects.create, {
    workspaceId,
    name: "From",
    color: "bg-blue-500",
  });
  const to = await asUser.mutation(api.projects.create, {
    workspaceId,
    name: "To",
    color: "bg-green-500",
  });
  const taskId = await asUser.mutation(api.tasks.create, {
    workspaceId,
    projectId: from,
    title: "Wanderer",
  });
  return { t, workspaceId, asUser, from, to, taskId };
}

describe("task project move", () => {
  it("keeps nodes.metadata.projectId in step with the task", async () => {
    const { t, from, to, taskId } = await setup();

    expect((await taskNode(t, taskId))?.metadata).toEqual({
      type: "task",
      projectId: from,
    });

    await moveTask(t, taskId, to);

    expect((await taskNode(t, taskId))?.metadata).toEqual({
      type: "task",
      projectId: to,
    });
  });

  it("repoints the belongs_to edge, leaving exactly one", async () => {
    const { t, from, to, taskId } = await setup();

    const before = await belongsToEdges(t, taskId);
    expect(before).toHaveLength(1);
    expect(before[0].targetId).toBe(from);

    await moveTask(t, taskId, to);

    const after = await belongsToEdges(t, taskId);
    expect(after).toHaveLength(1);
    expect(after[0].targetId).toBe(to);
  });

  it("groups the task under its new project in the workspace graph", async () => {
    // The consumer that would silently show the old project.
    const { t, workspaceId, asUser, from, to, taskId } = await setup();

    const before = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(before.nodes.find((n) => n.id === taskId)?.groupId).toBe(from);

    await moveTask(t, taskId, to);

    const after = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(after.nodes.find((n) => n.id === taskId)?.groupId).toBe(to);
  });

  it("does not touch the node when the project is unchanged", async () => {
    // The guard has to stay narrow: a task is patched on every status drag and
    // assignee change, and each node write lands in `nodes.by_workspace` — the
    // range the workspace graph subscribes to.
    const { t, asUser, taskId } = await setup();

    const before = await taskNode(t, taskId);
    await asUser.mutation(api.tasks.update, { taskId, priority: "high" });
    const after = await taskNode(t, taskId);

    expect(after?._id).toBe(before?._id);
    expect(after?.metadata).toEqual(before?.metadata);
  });

  it("still syncs the title when the project is unchanged", async () => {
    const { t, asUser, taskId, from } = await setup();

    await asUser.mutation(api.tasks.update, { taskId, title: "Renamed" });

    const node = await taskNode(t, taskId);
    expect(node?.name).toBe("Renamed");
    expect(node?.metadata).toEqual({ type: "task", projectId: from });
  });
});
