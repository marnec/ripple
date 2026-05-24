import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Insert a minimal task and return its id. The description-seed guard only
 * reads/patches `tasks.yjsSnapshotId`, so the other fields just need to satisfy
 * the schema.
 */
async function makeTask(
  t: ReturnType<typeof createTestContext>,
): Promise<Id<"tasks">> {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  return t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
    });
  });
}

async function storeBlob(
  t: ReturnType<typeof createTestContext>,
): Promise<Id<"_storage">> {
  return t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], {
        type: "application/octet-stream",
      }),
    ),
  );
}

/** Attach a taskIntegrationLink to an existing task (optionally user-edited). */
async function linkTask(
  t: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
  opts: { edited?: boolean } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    const task = (await ctx.db.get(taskId))!;
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      status: "active",
      pausedByBilling: false,
      externalRepoId: "R_kg1",
      externalRepoFullName: "acme/web",
    });
    await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: projectLinkId,
      externalIssueId: "I_kg1",
      externalUpdatedAt: 1_000,
      externalAuthor: { login: "o", avatarUrl: "a", url: "u" },
      descriptionEdited: opts.edited,
    });
  });
}

describe("snapshots.seedTaskSnapshot", () => {
  it("sets the snapshot when the task has none", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    const storageId = await storeBlob(t);

    const res = await t.mutation(internal.snapshots.seedTaskSnapshot, { taskId, storageId });

    expect(res.seeded).toBe(true);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.yjsSnapshotId).toBe(storageId);
  });

  it("overwrites a non-user (e.g. empty auto-saved) snapshot and deletes the old blob", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    await linkTask(t, taskId); // linked, NOT edited
    const stale = await storeBlob(t);
    await t.run((ctx) => ctx.db.patch(taskId, { yjsSnapshotId: stale }));

    const incoming = await storeBlob(t);
    const res = await t.mutation(internal.snapshots.seedTaskSnapshot, { taskId, storageId: incoming });

    expect(res.seeded).toBe(true);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.yjsSnapshotId).toBe(incoming);
    // the replaced (stale) blob is cleaned up
    expect(await t.run((ctx) => ctx.storage.get(stale))).toBeNull();
  });

  it("never overwrites a user-edited description and drops the incoming blob", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    await linkTask(t, taskId, { edited: true });
    const original = await storeBlob(t);
    await t.run((ctx) => ctx.db.patch(taskId, { yjsSnapshotId: original }));

    const incoming = await storeBlob(t);
    const res = await t.mutation(internal.snapshots.seedTaskSnapshot, { taskId, storageId: incoming });

    expect(res.seeded).toBe(false);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.yjsSnapshotId).toBe(original);
    expect(await t.run((ctx) => ctx.storage.get(incoming))).toBeNull();
  });

  it("drops the blob when the task no longer exists", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    await t.run((ctx) => ctx.db.delete(taskId));
    const storageId = await storeBlob(t);

    const res = await t.mutation(internal.snapshots.seedTaskSnapshot, { taskId, storageId });

    expect(res.seeded).toBe(false);
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });
});
