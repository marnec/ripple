import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin, channelFields } from "./helpers";
import { WorkspaceRole, ChannelType } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Sweep #25 — `recordVisit` used to take `resourceId: v.string()` with no
 * check at all, and `listRecent` handed the stored string to `ctx.db.get` with
 * a cast. These tests were themselves written against fake ids ("doc-123"),
 * which is what the fix now refuses: they seed real rows instead.
 */
async function seedDocument(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
  name = "My Document",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("documents", { workspaceId, name }),
  );
}

describe("recentActivity", () => {
  describe("recordVisit", () => {
    it("creates a new entry", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await seedDocument(t, workspaceId);

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: documentId,
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
      const documentId = await seedDocument(t, workspaceId);

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: documentId,
        resourceName: "Old Name",
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "document",
        resourceId: documentId,
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

    // The bug this closes: a malformed string used to be stored permanently,
    // and `ctx.db.get` on it throws in production ("Unable to decode ID"), so
    // one bad write killed the caller's whole Recent list with no way to clear
    // it from the UI. Refusing the write is what makes that unreachable.
    it("refuses a resourceId that is not an id of that resource's table", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await seedDocument(t, workspaceId);

      await expect(
        asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: "doc-123",
          resourceName: "Malformed",
        }),
      ).rejects.toThrow("Resource not found in this workspace");

      // Well-formed, but an id of the wrong table — `normalizeId` is
      // table-scoped, so this is refused too.
      await expect(
        asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "diagram",
          resourceId: documentId,
          resourceName: "Wrong table",
        }),
      ).rejects.toThrow("Resource not found in this workspace");

      const entries = await t.run(async (ctx) =>
        ctx.db.query("recentActivity").collect(),
      );
      expect(entries).toEqual([]);
    });

    it("refuses a resource that lives in another workspace", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      const otherWorkspaceId = await t.run(async (ctx) => {
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
      const foreignDoc = await seedDocument(t, otherWorkspaceId, "Foreign");

      await expect(
        asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: foreignDoc,
          resourceName: "Foreign",
        }),
      ).rejects.toThrow("Resource not found in this workspace");
    });

    // Channels take the CHANNEL rule, not the workspace rule. Validating a
    // channel against workspace membership alone would have turned this
    // mutation into an existence oracle for closed channels and DMs.
    it("applies the channel rule to a channel visit", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      const { openId, closedId } = await t.run(async (ctx) => {
        const openId = await ctx.db.insert("channels", {
          workspaceId,
          name: "general",
          ...channelFields("open"),
        });
        const closedId = await ctx.db.insert("channels", {
          workspaceId,
          name: "secrets",
          ...channelFields("closed"),
        });
        return { openId, closedId };
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId,
        resourceType: "channel",
        resourceId: openId,
        resourceName: "general",
      });

      // Workspace admin, but no channelMembers row for the closed channel.
      await expect(
        asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "channel",
          resourceId: closedId,
          resourceName: "secrets",
        }),
      ).rejects.toThrow();

      const entries = await t.run(async (ctx) =>
        ctx.db.query("recentActivity").collect(),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].resourceId).toBe(openId);
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const documentId = await seedDocument(t, workspaceId);

      await expect(
        t.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: documentId,
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

    // Rows written before `recordVisit` validated still exist. The read side
    // must degrade them to `deleted: true` rather than take out the list —
    // which is what the old `ctx.db.get(e.resourceId as Id<"channels">)` cast
    // did in production, where `db.get` throws on an undecodable id.
    it("greys out a legacy malformed row instead of failing the query", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const documentId = await seedDocument(t, workspaceId, "Live");

      await t.run(async (ctx) => {
        await ctx.db.insert("recentActivity", {
          userId,
          workspaceId,
          resourceType: "document",
          resourceId: "not-a-real-id",
          resourceName: "Legacy junk",
          visitedAt: 1000,
        });
        await ctx.db.insert("recentActivity", {
          userId,
          workspaceId,
          resourceType: "document",
          resourceId: documentId,
          resourceName: "Live",
          visitedAt: 2000,
        });
      });

      const results = await asUser.query(api.recentActivity.listRecent, { workspaceId });

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ resourceName: "Live", deleted: false });
      expect(results[1]).toMatchObject({ resourceName: "Legacy junk", deleted: true });
    });

    it("respects limit parameter", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      for (let i = 0; i < 5; i++) {
        const documentId = await seedDocument(t, workspaceId, `Doc ${i}`);
        await asUser.mutation(api.recentActivity.recordVisit, {
          workspaceId,
          resourceType: "document",
          resourceId: documentId,
          resourceName: `Doc ${i}`,
        });
      }

      const results = await asUser.query(api.recentActivity.listRecent, {
        workspaceId,
        limit: 2,
      });

      expect(results).toHaveLength(2);
    });

    it("clamps an oversized limit", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      await t.run(async (ctx) => {
        for (let i = 0; i < 60; i++) {
          await ctx.db.insert("recentActivity", {
            userId,
            workspaceId,
            resourceType: "document",
            resourceId: `legacy-${i}`,
            resourceName: `Doc ${i}`,
            visitedAt: i,
          });
        }
      });

      const results = await asUser.query(api.recentActivity.listRecent, {
        workspaceId,
        limit: 1_000_000,
      });

      expect(results).toHaveLength(50);
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

      const doc1 = await seedDocument(t, ws1, "WS1 Doc");
      const doc2 = await seedDocument(t, ws2, "WS2 Doc");

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId: ws1,
        resourceType: "document",
        resourceId: doc1,
        resourceName: "WS1 Doc",
      });

      await asUser.mutation(api.recentActivity.recordVisit, {
        workspaceId: ws2,
        resourceType: "document",
        resourceId: doc2,
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
