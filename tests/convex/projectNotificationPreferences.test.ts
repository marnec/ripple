import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";

const allTaskPrefs = {
  taskAssigned: true,
  taskDescriptionMention: true,
  taskCommentMention: true,
  taskComment: true,
  taskStatusChange: true,
};

async function setupProject(
  asUser: ReturnType<typeof import("convex-test").convexTest>["withIdentity"] extends (i: any) => infer R ? R : never,
  workspaceId: Id<"workspaces">,
) {
  return await asUser.mutation(api.projects.create, {
    name: "Test Project",
    workspaceId,
    color: "bg-blue-500",
  });
}

describe("projectNotificationPreferences", () => {
  describe("get", () => {
    it("returns null when no preferences exist", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      const prefs = await asUser.query(api.projectNotificationPreferences.get, { projectId });
      expect(prefs).toBeNull();
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      await expect(
        t.query(api.projectNotificationPreferences.get, { projectId }),
      ).rejects.toThrow("Not authenticated");
    });

    it("rejects non-workspace member", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);
      const { asUser: outsider } = await setupAuthenticatedUser(t, {
        name: "Outsider",
        email: "outsider@test.com",
      });

      await expect(
        outsider.query(api.projectNotificationPreferences.get, { projectId }),
      ).rejects.toThrow("Not a member of this workspace");
    });
  });

  describe("save", () => {
    it("creates preferences when none exist", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      await asUser.mutation(api.projectNotificationPreferences.save, {
        projectId,
        ...allTaskPrefs,
      });

      const prefs = await asUser.query(api.projectNotificationPreferences.get, { projectId });
      expect(prefs).not.toBeNull();
      expect(prefs!.taskAssigned).toBe(true);
      expect(prefs!.taskStatusChange).toBe(true);
    });

    it("updates existing preferences (upsert)", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      await asUser.mutation(api.projectNotificationPreferences.save, {
        projectId,
        ...allTaskPrefs,
      });

      await asUser.mutation(api.projectNotificationPreferences.save, {
        projectId,
        ...allTaskPrefs,
        taskAssigned: false,
      });

      const prefs = await asUser.query(api.projectNotificationPreferences.get, { projectId });
      expect(prefs!.taskAssigned).toBe(false);
      expect(prefs!.taskComment).toBe(true);

      // Verify only one row exists
      const count = await t.run(async (ctx) => {
        return (await ctx.db.query("projectNotificationPreferences").collect()).length;
      });
      expect(count).toBe(1);
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      await expect(
        t.mutation(api.projectNotificationPreferences.save, {
          projectId,
          ...allTaskPrefs,
        }),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("getForUsersInProject (internal)", () => {
    it("returns batch results for multiple users", async () => {
      const t = createTestContext();
      const { workspaceId, asUser: admin, userId: adminId } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(admin, workspaceId);
      const { userId: user2Id } = await setupAuthenticatedUser(t, {
        name: "User 2",
        email: "u2@test.com",
      });

      // Only admin has preferences
      await admin.mutation(api.projectNotificationPreferences.save, {
        projectId,
        ...allTaskPrefs,
        taskComment: false,
      });

      const results = await t.run(async (ctx) => {
        const r1 = await ctx.db
          .query("projectNotificationPreferences")
          .withIndex("by_user_project", (q) => q.eq("userId", adminId).eq("projectId", projectId))
          .unique();
        const r2 = await ctx.db
          .query("projectNotificationPreferences")
          .withIndex("by_user_project", (q) => q.eq("userId", user2Id).eq("projectId", projectId))
          .unique();
        return [r1, r2];
      });

      expect(results[0]).not.toBeNull();
      expect(results[0]!.taskComment).toBe(false);
      expect(results[1]).toBeNull();
    });
  });

  describe("cascade delete", () => {
    it("deletes project notification preferences when project is deleted", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const projectId = await setupProject(asUser, workspaceId);

      // Create task statuses (required for project deletion)
      await t.run(async (ctx) => {
        await ctx.db.insert("taskStatuses", {
          projectId,
          name: "Todo",
          color: "bg-gray-500",
          order: 0,
          isDefault: true,
          isCompleted: false,
        });
      });

      // Save notification preferences
      await asUser.mutation(api.projectNotificationPreferences.save, {
        projectId,
        ...allTaskPrefs,
      });

      // Verify they exist
      const before = await t.run(async (ctx) => {
        return (
          await ctx.db
            .query("projectNotificationPreferences")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
        ).length;
      });
      expect(before).toBe(1);

      // Delete project
      await asUser.mutation(api.projects.remove, { id: projectId });

      // Verify preferences are gone
      const after = await t.run(async (ctx) => {
        return (
          await ctx.db
            .query("projectNotificationPreferences")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
        ).length;
      });
      expect(after).toBe(0);
    });
  });
});
