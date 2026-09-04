import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * The dashboard calendar draws a task from `plannedStartDate ?? dueDate` to
 * `dueDate`. `listMineInRange` runs one range scan per date axis and unions
 * them, so a task is found when *either* endpoint lands in the window. It
 * used to subscribe to `listByAssignee` — every assigned task in the
 * workspace — and drop the undated ones in JS.
 */
async function setupFixture(t: ReturnType<typeof createTestContext>) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

  const { projectId, doneId } = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test Project",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "TST",
      taskCounter: 0,
    });
    await ctx.db.insert("taskStatuses", {
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
    return { projectId, doneId };
  });

  const createTask = (
    title: string,
    dates: { plannedStartDate?: string; dueDate?: string },
    assigneeId: Id<"users"> = userId,
  ) =>
    asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title,
      assigneeId,
      ...dates,
    });

  return { workspaceId, userId, asUser, projectId, doneId, createTask };
}

const WINDOW = { rangeStart: "2030-03-01", rangeEnd: "2030-03-31" };

describe("tasks.listMineInRange", () => {
  it("finds a task by either date endpoint inside the window", async () => {
    const t = createTestContext();
    const f = await setupFixture(t);

    const plannedOnly = await f.createTask("planned", { plannedStartDate: "2030-03-10" });
    const dueOnly = await f.createTask("due", { dueDate: "2030-03-20" });
    // Starts before the window, due inside it — the dueDate scan finds it.
    const spansIn = await f.createTask("spans in", {
      plannedStartDate: "2030-02-20",
      dueDate: "2030-03-05",
    });
    // Starts inside the window, due after it — the plannedStartDate scan.
    const spansOut = await f.createTask("spans out", {
      plannedStartDate: "2030-03-28",
      dueDate: "2030-04-10",
    });

    const result = await f.asUser.query(api.tasks.listMineInRange, {
      workspaceId: f.workspaceId,
      ...WINDOW,
    });
    expect(new Set(result.map((task) => task._id))).toEqual(
      new Set([plannedOnly, dueOnly, spansIn, spansOut]),
    );
  });

  it("returns each task once when both endpoints are inside the window", async () => {
    const t = createTestContext();
    const f = await setupFixture(t);

    const both = await f.createTask("both", {
      plannedStartDate: "2030-03-02",
      dueDate: "2030-03-09",
    });

    const result = await f.asUser.query(api.tasks.listMineInRange, {
      workspaceId: f.workspaceId,
      ...WINDOW,
    });
    expect(result.map((task) => task._id)).toEqual([both]);
    expect(result[0]).toMatchObject({
      title: "both",
      projectId: f.projectId,
      plannedStartDate: "2030-03-02",
      dueDate: "2030-03-09",
      completed: false,
    });
  });

  it("excludes undated, out-of-window, completed and other users' tasks", async () => {
    const t = createTestContext();
    const f = await setupFixture(t);

    const { userId: otherId } = await setupAuthenticatedUser(t, { email: "other@example.com" });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: otherId,
        workspaceId: f.workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await f.createTask("undated", {});
    await f.createTask("before", { plannedStartDate: "2030-02-01", dueDate: "2030-02-15" });
    await f.createTask("after", { dueDate: "2030-04-01" });
    await f.createTask("theirs", { dueDate: "2030-03-15" }, otherId);
    const done = await f.createTask("done", { dueDate: "2030-03-15" });
    await f.asUser.mutation(api.tasks.update, { taskId: done, statusId: f.doneId });
    const mine = await f.createTask("mine", { dueDate: "2030-03-15" });

    const result = await f.asUser.query(api.tasks.listMineInRange, {
      workspaceId: f.workspaceId,
      ...WINDOW,
    });
    expect(result.map((task) => task._id)).toEqual([mine]);
  });

  it("returns nothing for an inverted window", async () => {
    const t = createTestContext();
    const f = await setupFixture(t);
    await f.createTask("mine", { dueDate: "2030-03-15" });

    const result = await f.asUser.query(api.tasks.listMineInRange, {
      workspaceId: f.workspaceId,
      rangeStart: "2030-03-31",
      rangeEnd: "2030-03-01",
    });
    expect(result).toEqual([]);
  });
});
