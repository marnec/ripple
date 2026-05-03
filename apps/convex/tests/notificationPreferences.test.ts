import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
} from "./helpers";

const allEnabled = {
  chatMention: true,
  chatChannelMessage: true,
  taskAssigned: true,
  taskDescriptionMention: true,
  taskCommentMention: true,
  taskComment: true,
  taskStatusChange: true,
  documentMention: true,
  documentCreated: true,
  documentDeleted: true,
  spreadsheetCreated: true,
  spreadsheetDeleted: true,
  diagramCreated: true,
  diagramDeleted: true,
  projectCreated: true,
  projectDeleted: true,
  channelCreated: true,
  channelDeleted: true,
};

describe("notificationPreferences", () => {
  describe("get", () => {
    it("returns null when no preferences exist", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      const prefs = await asUser.query(api.notificationPreferences.get, {});
      expect(prefs).toBeNull();
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();

      await expect(
        t.query(api.notificationPreferences.get, {}),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("save", () => {
    it("creates preferences when none exist", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      await asUser.mutation(api.notificationPreferences.save, allEnabled);

      const prefs = await asUser.query(api.notificationPreferences.get, {});
      expect(prefs).not.toBeNull();
      expect(prefs!.chatMention).toBe(true);
      expect(prefs!.channelDeleted).toBe(true);
    });

    it("updates existing preferences (upsert)", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      // First save
      await asUser.mutation(api.notificationPreferences.save, allEnabled);

      // Update: disable chatChannelMessage
      await asUser.mutation(api.notificationPreferences.save, {
        ...allEnabled,
        chatChannelMessage: false,
      });

      const prefs = await asUser.query(api.notificationPreferences.get, {});
      expect(prefs!.chatChannelMessage).toBe(false);
      expect(prefs!.chatMention).toBe(true);

      // Verify only one row exists
      const count = await t.run(async (ctx) => {
        return (await ctx.db.query("notificationPreferences").collect()).length;
      });
      expect(count).toBe(1);
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();

      await expect(
        t.mutation(api.notificationPreferences.save, allEnabled),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("getForUser (internal)", () => {
    it("returns preferences for a specific user", async () => {
      const t = createTestContext();
      const { userId, asUser } = await setupAuthenticatedUser(t);

      await asUser.mutation(api.notificationPreferences.save, {
        ...allEnabled,
        taskAssigned: false,
      });

      const prefs = await t.run(async (ctx) => {
        return ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique();
      });

      expect(prefs).not.toBeNull();
      expect(prefs!.taskAssigned).toBe(false);
      expect(prefs!.chatMention).toBe(true);
    });

    it("returns null for user without preferences", async () => {
      const t = createTestContext();
      const { userId } = await setupAuthenticatedUser(t);

      const prefs = await t.run(async (ctx) => {
        return ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique();
      });

      expect(prefs).toBeNull();
    });
  });

  describe("getForUsers (internal)", () => {
    it("returns batch results for multiple users", async () => {
      const t = createTestContext();
      const user1 = await setupAuthenticatedUser(t, { name: "User 1", email: "u1@test.com" });
      const user2 = await setupAuthenticatedUser(t, { name: "User 2", email: "u2@test.com" });

      // Only user1 has preferences
      await user1.asUser.mutation(api.notificationPreferences.save, {
        ...allEnabled,
        diagramCreated: false,
      });

      const results = await t.run(async (ctx) => {
        const r1 = await ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user1.userId))
          .unique();
        const r2 = await ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user2.userId))
          .unique();
        return [r1, r2];
      });

      expect(results[0]).not.toBeNull();
      expect(results[0]!.diagramCreated).toBe(false);
      expect(results[1]).toBeNull();
    });
  });
});
