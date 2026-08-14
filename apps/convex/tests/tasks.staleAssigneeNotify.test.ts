import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import {
  deliveredPushes,
  resetDeliveredPushes,
  type DeliveredPush,
} from "./pushProbe";

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

beforeEach(() => {
  resetDeliveredPushes();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/**
 * A status-change push carries the task title to `tasks.assigneeId`. A *new*
 * assignee is proven in-workspace by `assertAssigneeInWorkspace`, but nothing
 * clears `assigneeId` when a member is removed from the workspace — and
 * `removeMembershipCascade` deliberately leaves it (the board should still
 * show who owned the work). So the stale value keeps resolving, and nothing
 * downstream re-checks: `notify` forwards recipients verbatim and
 * `deliverPush` filters only by the recipient's own preferences.
 *
 * The recipient list is therefore the access decision for the push body, and
 * it has to be made here under the same workspace rule the mention path uses.
 */
async function setupAssignedTask(t: ReturnType<typeof createTestContext>) {
  const {
    userId: adminId,
    workspaceId,
    asUser: asAdmin,
  } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: adminId });

  const { userId: assigneeId } = await setupAuthenticatedUser(t, {
    name: "Departing Member",
    email: "departing@example.com",
  });
  await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.insert("workspaceMembers", {
      userId: assigneeId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    });
  });

  const { todoId, doneId } = await t.run(async (ctx) => {
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
    return { todoId, doneId };
  });

  const taskId: Id<"tasks"> = await asAdmin.mutation(api.tasks.create, {
    projectId,
    workspaceId,
    title: "Migrate customer PII export",
    statusId: todoId,
    assigneeId,
  });

  return { adminId, asAdmin, workspaceId, projectId, assigneeId, taskId, doneId };
}

/** Status-change pushes delivered so far, flattened to recipient ids. */
async function statusChangeRecipients(
  t: ReturnType<typeof createTestContext>,
): Promise<string[]> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return (deliveredPushes as DeliveredPush[])
    .filter((p) => p.category === "taskStatusChange")
    .flatMap((p) => p.recipientIds);
}

describe("task status-change notifications and workspace membership", () => {
  it("pushes to an assignee who is still a workspace member", async () => {
    const t = createTestContext();
    const { asAdmin, taskId, doneId, assigneeId } = await setupAssignedTask(t);

    await asAdmin.mutation(api.tasks.update, { taskId, statusId: doneId });

    expect(await statusChangeRecipients(t)).toContain(assigneeId);
  });

  it("does not push to an assignee who was removed from the workspace", async () => {
    const t = createTestContext();
    const { asAdmin, workspaceId, taskId, doneId, assigneeId } =
      await setupAssignedTask(t);

    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: assigneeId,
    });
    resetDeliveredPushes();

    // The task row still names them — that is by design, and it is exactly
    // what makes `effectiveAssignee` resolve to a user who has lost access.
    const stale = await t.run((ctx) => ctx.db.get(taskId));
    expect(stale?.assigneeId).toBe(assigneeId);

    await asAdmin.mutation(api.tasks.update, { taskId, statusId: doneId });

    expect(await statusChangeRecipients(t)).not.toContain(assigneeId);
  });
});
