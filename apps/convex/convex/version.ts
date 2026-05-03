import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const doc = await ctx.db.query("appVersion").first();
    return doc?.deployedAt ?? null;
  },
});

export const set = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const existing = await ctx.db.query("appVersion").first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { deployedAt: now });
    } else {
      await ctx.db.insert("appVersion", { deployedAt: now });
    }
    return null;
  },
});
