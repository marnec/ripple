import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@shared/enums/roles";

describe("projects.create", () => {
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
      key: "ENG",
      taskCounter: 0,
    });

    // Verify 3 default statuses were seeded
    const statuses = await t.run(async (ctx) => {
      return await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
    });
    expect(statuses).toHaveLength(3);
    expect(statuses.map((s) => s.name)).toEqual([
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
    ).rejects.toThrow("Only workspace admins can create projects");
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
