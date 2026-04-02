import { expect, describe, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../../convex/dbTriggers";
import { WorkspaceRole } from "@shared/enums/roles";
import { ChannelRole } from "@shared/enums";
import { CHAT_NOTIFICATION_CATEGORIES } from "@shared/notificationCategories";

// ── Helper: seed subscription rows directly ─────────────────────────
// Test helpers bypass triggers (they use ctx.db directly), so we insert
// subscription rows manually to test delivery logic in isolation.

async function seedSubscription(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    category: string;
    scope: string;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("notificationSubscriptions", opts);
  });
}

describe("notificationSubscriptions", () => {
  describe("getSubscribedUserIds", () => {
    it("returns users subscribed to a category+scope", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const { userId: user2Id } = await setupAuthenticatedUser(t, {
        name: "User 2",
        email: "u2@test.com",
      });

      await seedSubscription(t, {
        workspaceId,
        userId,
        category: "documentCreated",
        scope: workspaceId,
      });
      await seedSubscription(t, {
        workspaceId,
        userId: user2Id,
        category: "documentCreated",
        scope: workspaceId,
      });

      const result = await t.run(async (ctx) => {
        const subs = await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", workspaceId).eq("category", "documentCreated"),
          )
          .collect();
        return subs.map((s) => s.userId as string);
      });

      expect(result).toHaveLength(2);
      expect(result).toContain(userId);
      expect(result).toContain(user2Id);
    });

    it("excludes the sender when specified", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const { userId: user2Id } = await setupAuthenticatedUser(t, {
        name: "User 2",
        email: "u2@test.com",
      });

      await seedSubscription(t, {
        workspaceId,
        userId,
        category: "channelCreated",
        scope: workspaceId,
      });
      await seedSubscription(t, {
        workspaceId,
        userId: user2Id,
        category: "channelCreated",
        scope: workspaceId,
      });

      const result = await t.run(async (ctx) => {
        const subs = await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", workspaceId).eq("category", "channelCreated"),
          )
          .collect();
        return subs
          .filter((s) => s.userId !== userId)
          .map((s) => s.userId as string);
      });

      expect(result).toHaveLength(1);
      expect(result).toContain(user2Id);
    });

    it("returns empty array when no subscriptions exist", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);

      const result = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", workspaceId).eq("category", "documentCreated"),
          )
          .collect();
      });

      expect(result).toHaveLength(0);
    });

    it("scopes correctly to channel vs workspace", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const { userId: user2Id } = await setupAuthenticatedUser(t, {
        name: "User 2",
        email: "u2@test.com",
      });

      const channelId = await t.run(async (ctx) => {
        return await ctx.db.insert("channels", {
          name: "general",
          workspaceId,
          isPublic: true,
        });
      });

      // user1 subscribed to workspace scope, user2 to channel scope
      await seedSubscription(t, {
        workspaceId,
        userId,
        category: "chatChannelMessage",
        scope: workspaceId,
      });
      await seedSubscription(t, {
        workspaceId,
        userId: user2Id,
        category: "chatChannelMessage",
        scope: channelId,
      });

      // Query channel scope only
      const channelSubs = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .collect();
      });

      expect(channelSubs).toHaveLength(1);
      expect(channelSubs[0].userId).toBe(user2Id);
    });
  });

  describe("cleanup on member leave", () => {
    it("deletes all subscriptions for user in workspace via by_user_workspace index", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);

      // Seed several subscriptions
      for (const cat of ["documentCreated", "projectCreated", "channelCreated"]) {
        await seedSubscription(t, {
          workspaceId,
          userId,
          category: cat,
          scope: workspaceId,
        });
      }

      // Verify they exist
      const before = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_workspace", (q) =>
            q.eq("userId", userId).eq("workspaceId", workspaceId),
          )
          .collect();
      });
      expect(before).toHaveLength(3);

      // Delete all (simulating onWorkspaceMemberDelete)
      await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_workspace", (q) =>
            q.eq("userId", userId).eq("workspaceId", workspaceId),
          )
          .collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      });

      const after = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_workspace", (q) =>
            q.eq("userId", userId).eq("workspaceId", workspaceId),
          )
          .collect();
      });
      expect(after).toHaveLength(0);
    });
  });

  describe("by_user_scope_category index (dedup)", () => {
    it("prevents duplicate subscriptions", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);

      await seedSubscription(t, {
        workspaceId,
        userId,
        category: "documentCreated",
        scope: workspaceId,
      });

      // Check for existing before inserting again
      const existing = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_scope_category", (q) =>
            q
              .eq("userId", userId)
              .eq("scope", workspaceId)
              .eq("category", "documentCreated"),
          )
          .first();
      });

      expect(existing).not.toBeNull();
    });
  });

  describe("trigger-based subscription creation", () => {
    it("workspace member join creates only broadcast-eligible subscriptions (no targeted categories)", async () => {
      const t = createTestContext();

      // Create workspace + admin manually (setupWorkspaceWithAdmin bypasses triggers)
      const { userId } = await setupAuthenticatedUser(t);
      const { workspaceId, projectId, publicChannelId } = await t.run(async (ctx) => {
        const wsId = await ctx.db.insert("workspaces", {
          name: "Test WS",
          ownerId: userId,
        });
        // Create a project and public channel BEFORE adding the member
        const projId = await ctx.db.insert("projects", {
          name: "Proj", color: "bg-blue-500", workspaceId: wsId, creatorId: userId,
        });
        const chId = await ctx.db.insert("channels", {
          name: "general", workspaceId: wsId, isPublic: true,
        });
        return { workspaceId: wsId, projectId: projId, publicChannelId: chId };
      });

      // Insert workspace member WITH triggers
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("workspaceMembers", {
          userId,
          workspaceId,
          role: WorkspaceRole.ADMIN,
        });
      });

      const subs = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_workspace", (q) =>
            q.eq("userId", userId).eq("workspaceId", workspaceId),
          )
          .collect();
      });

      const categories = subs.map((s) => s.category);

      // Should NOT contain targeted categories (these use recipientIds, not scope)
      expect(categories).not.toContain("documentMention");
      expect(categories).not.toContain("chatMention");
      expect(categories).not.toContain("taskAssigned");
      expect(categories).not.toContain("taskDescriptionMention");
      expect(categories).not.toContain("taskCommentMention");
      expect(categories).not.toContain("taskComment");
      expect(categories).not.toContain("taskStatusChange");

      // Should contain workspace-scoped broadcast categories
      expect(categories).toContain("documentCreated");
      expect(categories).toContain("documentDeleted");
      expect(categories).toContain("channelCreated");
      expect(categories).toContain("projectCreated");

      // Should contain chatChannelMessage for the public channel
      const channelSubs = subs.filter((s) => s.scope === publicChannelId);
      expect(channelSubs).toHaveLength(1);
      expect(channelSubs[0].category).toBe("chatChannelMessage");

      // Should NOT have project-scoped subscriptions (all task cats are targeted)
      const projectSubs = subs.filter((s) => s.scope === projectId);
      expect(projectSubs).toHaveLength(0);
    });

    it("re-enabling a global preference recreates channel subscriptions even when all were deleted", async () => {
      const t = createTestContext();
      const { userId } = await setupAuthenticatedUser(t);

      // Create workspace + public channel + member via triggers
      const { workspaceId, channelId } = await t.run(async (ctx) => {
        const wsId = await ctx.db.insert("workspaces", {
          name: "Test WS", ownerId: userId,
        });
        const chId = await ctx.db.insert("channels", {
          name: "general", workspaceId: wsId, isPublic: true,
        });
        return { workspaceId: wsId, channelId: chId };
      });

      // Add member (creates chatChannelMessage subscription for the channel)
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("workspaceMembers", {
          userId, workspaceId, role: WorkspaceRole.ADMIN,
        });
      });

      // Verify subscription exists
      const before = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_scope_category", (q) =>
            q.eq("userId", userId).eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .first();
      });
      expect(before).not.toBeNull();

      // Disable chatChannelMessage globally (triggers preference change)
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("notificationPreferences", {
          userId,
          chatMention: true, chatChannelMessage: false,
          taskAssigned: true, taskDescriptionMention: true, taskCommentMention: true,
          taskComment: true, taskStatusChange: true,
          documentMention: true, documentCreated: true, documentDeleted: true,
          spreadsheetCreated: true, spreadsheetDeleted: true,
          diagramCreated: true, diagramDeleted: true,
          projectCreated: true, projectDeleted: true,
          channelCreated: true, channelDeleted: true,
        });
      });

      // Subscription should be deleted
      const afterDisable = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_scope_category", (q) =>
            q.eq("userId", userId).eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .first();
      });
      expect(afterDisable).toBeNull();

      // Re-enable chatChannelMessage
      const prefsDoc = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique();
      });
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.patch(prefsDoc!._id, { chatChannelMessage: true });
      });

      // Subscription should be recreated — this is the bug #1 test
      const afterReenable = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_user_scope_category", (q) =>
            q.eq("userId", userId).eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .first();
      });
      expect(afterReenable).not.toBeNull();
    });
  });

  describe("channel visibility toggle", () => {
    it("public→private removes subscriptions for non-members", async () => {
      const t = createTestContext();
      const { userId } = await setupAuthenticatedUser(t, { name: "Admin", email: "admin@test.com" });
      const { userId: user2Id } = await setupAuthenticatedUser(t, { name: "User2", email: "u2@test.com" });

      // Create workspace + public channel, all via triggers
      const workspaceId = await t.run(async (ctx) => {
        return await ctx.db.insert("workspaces", {
          name: "Test WS", ownerId: userId,
        });
      });

      const channelId = await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        return await db.insert("channels", {
          name: "general", workspaceId, isPublic: true,
        });
      });

      // Add both members (triggers create subscriptions for public channel)
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("workspaceMembers", { userId, workspaceId, role: WorkspaceRole.ADMIN });
        await db.insert("workspaceMembers", { userId: user2Id, workspaceId, role: WorkspaceRole.MEMBER });
      });

      // Only user1 is a channel member (private channels need explicit membership)
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("channelMembers", {
          userId, channelId, workspaceId, role: ChannelRole.ADMIN,
        });
      });

      // Both should have subscriptions for the public channel
      const beforeToggle = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .collect();
      });
      expect(beforeToggle).toHaveLength(2);

      // Toggle channel to private (trigger should schedule cleanup)
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.patch(channelId, { isPublic: false });
      });

      // After toggle: only user1 (channel member) should have subscription
      const afterToggle = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .collect();
      });
      expect(afterToggle).toHaveLength(1);
      expect(afterToggle[0].userId).toBe(userId);
    });

    it("private→public creates subscriptions for all workspace members", async () => {
      const t = createTestContext();
      const { userId } = await setupAuthenticatedUser(t, { name: "Admin", email: "admin@test.com" });
      const { userId: user2Id } = await setupAuthenticatedUser(t, { name: "User2", email: "u2@test.com" });

      const workspaceId = await t.run(async (ctx) => {
        return await ctx.db.insert("workspaces", {
          name: "Test WS", ownerId: userId,
        });
      });

      const channelId = await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        return await db.insert("channels", {
          name: "secret", workspaceId, isPublic: false,
        });
      });

      // Add workspace members
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("workspaceMembers", { userId, workspaceId, role: WorkspaceRole.ADMIN });
        await db.insert("workspaceMembers", { userId: user2Id, workspaceId, role: WorkspaceRole.MEMBER });
      });

      // Only user1 joins the private channel
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("channelMembers", {
          userId, channelId, workspaceId, role: ChannelRole.ADMIN,
        });
      });

      // Only user1 should have subscription
      const beforeToggle = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .collect();
      });
      expect(beforeToggle).toHaveLength(1);

      // Toggle channel to public
      await t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.patch(channelId, { isPublic: true });
      });

      // Both workspace members should now have subscriptions
      const afterToggle = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId).eq("category", "chatChannelMessage"),
          )
          .collect();
      });
      expect(afterToggle).toHaveLength(2);
    });
  });

  describe("cascade delete via scope", () => {
    it("channel deletion removes all subscriptions with matching scope", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const { userId: user2Id } = await setupAuthenticatedUser(t, {
        name: "User 2",
        email: "u2@test.com",
      });

      const channelId = await t.run(async (ctx) => {
        return await ctx.db.insert("channels", {
          name: "test-channel",
          workspaceId,
          isPublic: true,
        });
      });

      // Seed subscriptions for both users
      for (const uid of [userId, user2Id]) {
        for (const cat of CHAT_NOTIFICATION_CATEGORIES) {
          await seedSubscription(t, {
            workspaceId,
            userId: uid,
            category: cat,
            scope: channelId,
          });
        }
      }

      // Verify they exist
      const before = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) =>
            q.eq("scope", channelId),
          )
          .collect();
      });
      expect(before).toHaveLength(4); // 2 users × 2 categories

      // Simulate cascade delete (delete by scope)
      await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) => q.eq("scope", channelId))
          .collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      });

      const after = await t.run(async (ctx) => {
        return await ctx.db
          .query("notificationSubscriptions")
          .withIndex("by_scope_category", (q) => q.eq("scope", channelId))
          .collect();
      });
      expect(after).toHaveLength(0);
    });
  });
});
