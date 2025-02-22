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
  handler: async (ctx, { endpoint, expirationTime, keys, device }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("User not authenticated");

    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (subscription) return;

    return ctx.db.insert("pushSubscriptions", { endpoint, expirationTime, keys, userId, device });
  },
});

export const unregisterSubscription = mutation({
  args: {
    endpoint: v.string(),
  },
  handler: async (ctx, { endpoint }) => {
    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (!subscription) return;

    return ctx.db.delete(subscription?._id);
  },
});

export const listNonSelfSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    ctx.db.query("workspaces");

    return ctx.db
      .query("pushSubscriptions")
      .filter((q) => q.neq(q.field("userId"), userId))
      .collect();
  },
});

export const usersSubscriptions = query({
  args: { usersIds: v.array(v.id("users")) },
  handler: async (ctx, { usersIds }) => {
    return Promise.all(
      usersIds
        .map((id) =>
          ctx.db
            .query("pushSubscriptions")
            .withIndex("by_user", (q) => q.eq("userId", id))
            .first(),
        )
        .filter(Boolean),
    ).then((subs) => subs.filter((s) => s !== null));
  },
});
