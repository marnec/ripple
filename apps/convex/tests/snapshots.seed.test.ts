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

describe("snapshots.seedTaskSnapshotIfAbsent", () => {
  it("sets the snapshot when the task has none", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    const storageId = await storeBlob(t);

    const res = await t.mutation(internal.snapshots.seedTaskSnapshotIfAbsent, {
      taskId,
      storageId,
    });

    expect(res.seeded).toBe(true);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.yjsSnapshotId).toBe(storageId);
  });

  it("never clobbers an existing snapshot and drops the orphan blob", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    const original = await storeBlob(t);
    await t.run((ctx) => ctx.db.patch(taskId, { yjsSnapshotId: original }));

    const incoming = await storeBlob(t);
    const res = await t.mutation(internal.snapshots.seedTaskSnapshotIfAbsent, {
      taskId,
      storageId: incoming,
    });

    expect(res.seeded).toBe(false);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.yjsSnapshotId).toBe(original);
    // the rejected blob is cleaned up, not leaked
    const incomingBlob = await t.run((ctx) => ctx.storage.get(incoming));
    expect(incomingBlob).toBeNull();
  });

  it("drops the blob when the task no longer exists", async () => {
    const t = createTestContext();
    const taskId = await makeTask(t);
    await t.run((ctx) => ctx.db.delete(taskId));
    const storageId = await storeBlob(t);

    const res = await t.mutation(internal.snapshots.seedTaskSnapshotIfAbsent, {
      taskId,
      storageId,
    });

    expect(res.seeded).toBe(false);
    const blob = await t.run((ctx) => ctx.storage.get(storageId));
    expect(blob).toBeNull();
  });
});
