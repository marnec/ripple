import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
} from "./helpers";

describe("pushSubscription", () => {
  describe("registerSubscription", () => {
    it("registers a push subscription for authenticated user", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      await asUser.mutation(api.pushSubscription.registerSubscription, {
        device: "chrome",
        endpoint: "https://fcm.googleapis.com/push/abc",
        expirationTime: null,
        keys: { p256dh: "key1", auth: "auth1" },
      });

      const subs = await t.run(async (ctx) => {
        return ctx.db.query("pushSubscriptions").collect();
      });
      expect(subs).toHaveLength(1);
      expect(subs[0].endpoint).toBe("https://fcm.googleapis.com/push/abc");
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();

      await expect(
        t.mutation(api.pushSubscription.registerSubscription, {
          device: "chrome",
          endpoint: "https://fcm.googleapis.com/push/abc",
          expirationTime: null,
          keys: { p256dh: "key1", auth: "auth1" },
        }),
      ).rejects.toThrow("Not authenticated");
    });

    it("is idempotent for same endpoint", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      const args = {
        device: "chrome",
        endpoint: "https://fcm.googleapis.com/push/abc",
        expirationTime: null,
        keys: { p256dh: "key1", auth: "auth1" },
      };

      await asUser.mutation(api.pushSubscription.registerSubscription, args);
      await asUser.mutation(api.pushSubscription.registerSubscription, args);

      const subs = await t.run(async (ctx) => {
        return ctx.db.query("pushSubscriptions").collect();
      });
      expect(subs).toHaveLength(1);
    });
  });

  describe("unregisterSubscription", () => {
    it("unregisters own subscription", async () => {
      const t = createTestContext();
      const { userId, asUser } = await setupAuthenticatedUser(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("pushSubscriptions", {
          userId,
          device: "chrome",
          endpoint: "https://fcm.googleapis.com/push/abc",
          expirationTime: null,
          keys: { p256dh: "key1", auth: "auth1" },
        });
      });

      await asUser.mutation(api.pushSubscription.unregisterSubscription, {
        endpoint: "https://fcm.googleapis.com/push/abc",
      });

      const subs = await t.run(async (ctx) => {
        return ctx.db.query("pushSubscriptions").collect();
      });
      expect(subs).toHaveLength(0);
    });

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();

      await expect(
        t.mutation(api.pushSubscription.unregisterSubscription, {
          endpoint: "https://fcm.googleapis.com/push/abc",
        }),
      ).rejects.toThrow("Not authenticated");
    });

    it("rejects unregistering another user's subscription", async () => {
      const t = createTestContext();
      const { userId: otherUserId } = await setupAuthenticatedUser(t, {
        name: "Other",
        email: "other@example.com",
      });
      const { asUser } = await setupAuthenticatedUser(t, {
        name: "Attacker",
        email: "attacker@example.com",
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("pushSubscriptions", {
          userId: otherUserId,
          device: "chrome",
          endpoint: "https://fcm.googleapis.com/push/victim",
          expirationTime: null,
          keys: { p256dh: "key1", auth: "auth1" },
        });
      });

      await expect(
        asUser.mutation(api.pushSubscription.unregisterSubscription, {
          endpoint: "https://fcm.googleapis.com/push/victim",
        }),
      ).rejects.toThrow("Not authorized");
    });

    it("no-ops for nonexistent endpoint", async () => {
      const t = createTestContext();
      const { asUser } = await setupAuthenticatedUser(t);

      // Should not throw
      await asUser.mutation(api.pushSubscription.unregisterSubscription, {
        endpoint: "https://fcm.googleapis.com/push/nonexistent",
      });
    });
  });
});
