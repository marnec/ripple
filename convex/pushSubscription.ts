import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const registerSubscription = mutation({
  args: {
    device: v.string(),
    endpoint: v.string(),
    expirationTime: v.union(v.number(), v.null()),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { endpoint, expirationTime, keys, device }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("User not authenticated");

    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (subscription) return null;

    await ctx.db.insert("pushSubscriptions", { endpoint, expirationTime, keys, userId, device });
    return null;
  },
});

export const unregisterSubscription = mutation({
  args: {
    endpoint: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("User not authenticated");

    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (!subscription) return null;

    // Only allow users to unregister their own subscriptions
    if (subscription.userId !== userId) {
      throw new ConvexError("Not authorized to unregister this subscription");
    }

    await ctx.db.delete(subscription._id);
    return null;
  },
});

export const usersSubscriptions = query({
  args: { usersIds: v.array(v.id("users")) },
  returns: v.array(v.object({
    _id: v.id("pushSubscriptions"),
    _creationTime: v.number(),
    userId: v.id("users"),
    device: v.string(),
    endpoint: v.string(),
    expirationTime: v.union(v.number(), v.null()),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
  })),
  handler: async (ctx, { usersIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("User not authenticated");

    const results = await Promise.all(
      usersIds.map((id) =>
        ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first(),
      ),
    );
    return results.filter((s): s is NonNullable<typeof s> => s !== null);
  },
});
