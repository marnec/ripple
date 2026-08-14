import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

describe("projects.create", () => {
  it("seeds a Triage status so the integration activation gate has a destination", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "Engineering",
      color: "bg-blue-500",
      workspaceId,
    });

    const statuses = await t.run(async (ctx) =>
      ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const triage = statuses.find((s) => s.isTriage === true);
    expect(triage).toBeDefined();
    // Triage is the inbox for externally-ingested issues — leftmost.
    expect(triage?.order).toBe(0);
    // Triage and isDefault are mutually exclusive: Todo stays the default
    // destination for user-created tasks.
    expect(triage?.isDefault).toBe(false);
    expect(triage?.isCompleted).toBe(false);
  });

  it("creates a project with seeded statuses and auto-generated key", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const projectId = await asUser.mutation(api.projects.create, {
      name: "Engineering",
      color: "bg-blue-500",
      workspaceId,
    });

    expect(projectId).toBeDefined();

    // Verify project was created correctly
    const project = await t.run(async (ctx) => {
      return await ctx.db.get(projectId);
    });
    expect(project).toMatchObject({
      name: "Engineering",
      color: "bg-blue-500",
      key: "ENGI",
      taskCounter: 0,
    });

    // Verify default statuses were seeded in expected order.
    const statuses = await t.run(async (ctx) => {
      return await ctx.db
        .query("taskStatuses")
        .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
        .collect();
    });
    expect(statuses.map((s) => s.name)).toEqual([
      "Triage",
      "Todo",
      "In Progress",
      "Done",
    ]);
    expect(statuses.find((s) => s.isDefault)?.name).toBe("Todo");
  });

  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const { userId: memberId, asUser: asMember } =
      await setupAuthenticatedUser(t, {
        name: "Member",
        email: "member@test.com",
      });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await expect(
      asMember.mutation(api.projects.create, {
        name: "Forbidden",
        color: "bg-red-500",
        workspaceId,
      }),
    ).rejects.toThrow("Insufficient permissions");
  });

  it("rejects unauthenticated users", async () => {
    const t = createTestContext();
    // Create real workspace so arg validation passes, but don't set identity
    const workspaceId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Owner", email: "o@t.com" });
      return await ctx.db.insert("workspaces", { name: "WS", ownerId: userId });
    });
    await expect(
      t.mutation(api.projects.create, {
        name: "Test",
        color: "bg-blue-500",
        workspaceId,
      }),
    ).rejects.toThrow("Not authenticated");
  });
});

/**
 * `update` and `remove` used to gate on `requireUser` + `requireCreator` alone.
 * `removeMembershipCascade` never clears `projects.creatorId`, so the creator
 * link outlives the membership: an offboarded creator kept the power to rename
 * — and to cascade-delete — their old project. These pin the workspace rule as
 * the gate and the creator check as a narrowing on top of it.
 */
describe("projects.update / projects.remove — membership is the gate", () => {
  /** Workspace with `alice` (admin, creator), `bob` (admin) and `carol` (member). */
  async function setupCast(t: ReturnType<typeof createTestContext>) {
    const alice = await setupWorkspaceWithAdmin(t);
    const bob = await setupAuthenticatedUser(t, { name: "Bob", email: "bob@test.com" });
    const carol = await setupAuthenticatedUser(t, { name: "Carol", email: "carol@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: bob.userId,
        workspaceId: alice.workspaceId,
        role: WorkspaceRole.ADMIN,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: carol.userId,
        workspaceId: alice.workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const projectId = await alice.asUser.mutation(api.projects.create, {
      name: "Engineering",
      color: "bg-blue-500",
      workspaceId: alice.workspaceId,
    });

    return { alice, bob, carol, projectId, workspaceId: alice.workspaceId };
  }

  /** What offboarding does: the membership row goes, `creatorId` stays. */
  async function offboard(
    t: ReturnType<typeof createTestContext>,
    userId: Id<"users">,
    workspaceId: Id<"workspaces">,
  ) {
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId),
        )
        .first();
      if (membership) await ctx.db.delete(membership._id);
    });
  }

  it("update refuses a creator who has been removed from the workspace", async () => {
    const t = createTestContext();
    const { alice, projectId, workspaceId } = await setupCast(t);
    await offboard(t, alice.userId, workspaceId);

    await expect(
      alice.asUser.mutation(api.projects.update, { id: projectId, name: "pwned" }),
      // The membership check must run FIRST: the creator check's distinct
      // message would otherwise confirm the project exists to a non-member.
    ).rejects.toThrow("Not a member of this workspace");

    const stored = await t.run((ctx) => ctx.db.get(projectId));
    expect(stored?.name, "the rename must not have landed").toBe("Engineering");
  });

  it("remove refuses a creator who has been removed from the workspace", async () => {
    const t = createTestContext();
    const { alice, projectId, workspaceId } = await setupCast(t);

    const taskId = await alice.asUser.mutation(api.tasks.create, {
      workspaceId,
      projectId,
      title: "Survives",
    });

    await offboard(t, alice.userId, workspaceId);

    await expect(
      alice.asUser.mutation(api.projects.remove, { id: projectId }),
    ).rejects.toThrow("Not a member of this workspace");

    const [project, task] = await t.run(async (ctx) => [
      await ctx.db.get(projectId),
      await ctx.db.get(taskId),
    ]);
    expect(project, "the cascade must not have run").not.toBeNull();
    expect(task, "the project's tasks must survive").not.toBeNull();
  });

  it("refuses a workspace member who is neither creator nor admin", async () => {
    const t = createTestContext();
    const { carol, projectId } = await setupCast(t);

    await expect(
      carol.asUser.mutation(api.projects.update, { id: projectId, name: "pwned" }),
      // Membership alone is not enough — the creator narrowing still applies.
    ).rejects.toThrow("Only the project creator or a workspace admin");
  });

  it("lets a workspace admin who is not the creator rename and delete", async () => {
    const t = createTestContext();
    const { alice, bob, projectId, workspaceId } = await setupCast(t);

    // The dead end the narrow fix would have introduced: with the creator gone
    // and no admin arm, nobody could rename or delete this project again.
    await offboard(t, alice.userId, workspaceId);

    await bob.asUser.mutation(api.projects.update, { id: projectId, name: "Platform" });
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.name).toBe("Platform");

    await bob.asUser.mutation(api.projects.remove, { id: projectId });
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeNull();
  });

  it("still lets the creator rename their own project", async () => {
    const t = createTestContext();
    const { alice, projectId } = await setupCast(t);

    await alice.asUser.mutation(api.projects.update, { id: projectId, name: "Renamed" });
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.name).toBe("Renamed");
  });
});
