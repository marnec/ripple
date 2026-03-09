import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@shared/enums/roles";

describe("recentActivity", () => {
  describe("recordVisit", () => {
    it("creates a new entry", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: "doc-123",
        resourceName: "My Document",
      });

      const entries = await t.run(async (ctx) => {
        return ctx.db
          .query("recentActivity")
          .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
          .collect();
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].resourceName).toBe("My Document");
      expect(entries[0].resourceType).toBe("document");
    });

    it("upserts when visiting the same resource again", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: "doc-123",
        resourceName: "Old Name",
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: "doc-123",
        resourceName: "Updated Name",
      });

      const entries = await t.run(async (ctx) => {
        return ctx.db
          .query("recentActivity")
          .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
          .collect();
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].resourceName).toBe("Updated Name");
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);

      await expect(
        t.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: "doc-123",
          resourceName: "Test",
        }),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("listRecent", () => {
    it("returns items sorted by visitedAt desc", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      // Insert directly with explicit timestamps to guarantee ordering
      await t.run(async (ctx) => {
        await ctx.db.insert("recentActivity", {
          userId,
          workspaceId,
          resourceType: "document",
          resourceId: "doc-1",
          resourceName: "First",
          visitedAt: 1000,
        });
        await ctx.db.insert("recentActivity", {
          userId,
          workspaceId,
          resourceType: "diagram",
          resourceId: "diag-1",
          resourceName: "Second",
          visitedAt: 2000,
        });
        await ctx.db.insert("recentActivity", {
          userId,
          workspaceId,
          resourceType: "channel",
          resourceId: "chan-1",
          resourceName: "Third",
          visitedAt: 3000,
        });
      });

      const results = await asUser.query(api.recentActivity.listRecent, { workspaceId });

      expect(results).toHaveLength(3);
      expect(results[0].resourceName).toBe("Third");
      expect(results[1].resourceName).toBe("Second");
      expect(results[2].resourceName).toBe("First");
    });

    it("respects limit parameter", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      for (let i = 0; i < 5; i++) {
        await asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: `doc-${i}`,
          resourceName: `Doc ${i}`,
        });
      }

      const results = await asUser.query(api.recentActivity.listRecent, {
        workspaceId,
        limit: 2,
      });

      expect(results).toHaveLength(2);
    });

    it("scopes to workspace (doesn't leak cross-workspace)", async () => {
      const t = createTestContext();
      const { userId, workspaceId: ws1, asUser } = await setupWorkspaceWithAdmin(t);

      // Create second workspace
      const ws2 = await t.run(async (ctx) => {
        const wsId = await ctx.db.insert("workspaces", {
          name: "Other Workspace",
          ownerId: userId,
        });
        await ctx.db.insert("workspaceMembers", {
          userId,
          workspaceId: wsId,
          role: WorkspaceRole.ADMIN,
        });
        return wsId;
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId: ws1,
        resourceType: "document",
        resourceId: "doc-ws1",
        resourceName: "WS1 Doc",
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId: ws2,
        resourceType: "document",
        resourceId: "doc-ws2",
        resourceName: "WS2 Doc",
      });

      const ws1Results = await asUser.query(api.recentActivity.listRecent, { workspaceId: ws1 });
      const ws2Results = await asUser.query(api.recentActivity.listRecent, { workspaceId: ws2 });

      expect(ws1Results).toHaveLength(1);
      expect(ws1Results[0].resourceName).toBe("WS1 Doc");
      expect(ws2Results).toHaveLength(1);
      expect(ws2Results[0].resourceName).toBe("WS2 Doc");
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);

      await expect(
        t.query(api.recentActivity.listRecent, { workspaceId }),
      ).rejects.toThrow("Not authenticated");
    });
  });
});
