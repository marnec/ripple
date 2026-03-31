import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { userValidator } from "./validators";
import { getUser, requireUser } from "./authHelpers";

export const viewer = query({
  args: {},
  returns: v.union(userValidator, v.null()),
  handler: async (ctx) => {
    const userId = await getUser(ctx);

    if (!userId) return null;

    return ctx.db.get(userId);
  },
});

export const get = query({
  args: { id: v.id("users") },
  returns: v.union(userValidator, v.null()),
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, name }) => {
    const currentUserId = await requireUser(ctx);
    if (currentUserId !== userId) throw new ConvexError("Not authorized to update this user");

    await ctx.db.patch(userId, {
      name,
    });
    return null;
  },
});

export const getByIds = query({
  args: { ids: v.array(v.id("users")) },
  returns: v.record(v.id("users"), userValidator),
  handler: async (ctx, { ids }) => {
    if (ids.length === 0) {
      return {};
    }
    const users = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const userMap: Record<Id<"users">, Doc<"users">> = {};
    users
      .filter((u): u is Doc<"users"> => u !== null)
      .forEach((user) => {
        userMap[user._id] = user;
      });
    return userMap;
  },
});
