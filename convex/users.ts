import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, { userId, name }) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) throw new Error("Not authenticated");
    if (currentUserId !== userId) throw new Error("Not authorized to update this user");

    await ctx.db.patch(userId, {
      name,
    });
  },
});
