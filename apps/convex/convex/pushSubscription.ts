import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireUser } from "./authHelpers";

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
    const userId = await requireUser(ctx);

    // Check if this exact endpoint is already registered
    const byEndpoint = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (byEndpoint) return null;

    // Upsert: replace any existing subscription for this user+device
    // (handles stale subscriptions after site data clear)
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const sub of existing) {
      if (sub.device === device) {
        await ctx.db.delete(sub._id);
      }
    }

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
    const userId = await requireUser(ctx);

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

/** Remove stale push subscriptions by endpoint (called when web-push returns 410 Gone). */
export const removeStaleEndpoints = internalMutation({
  args: { endpoints: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { endpoints }) => {
    for (const endpoint of endpoints) {
      const sub = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
        .first();
      if (sub) await ctx.db.delete(sub._id);
    }
    return null;
  },
});

export const usersSubscriptions = internalQuery({
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
    const results = await Promise.all(
      usersIds.map((id) =>
        ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .collect(),
      ),
    );
    return results.flat();
  },
});
