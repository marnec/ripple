import { query } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";

export const get = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const doc = await ctx.db.query("appVersion").first();
    return doc?.deployedAt ?? null;
  },
});

/**
 * Stamps the deploy time that `get` broadcasts to every connected client as a
 * "reload to get the new build" signal.
 *
 * Internal, not public: it took no args and had no auth check, so any anonymous
 * caller could prompt every user in every workspace to reload, as fast as they
 * could send requests. Its only legitimate caller is the deploy script
 * (`convex run version:set --prod`), which runs with admin credentials and can
 * therefore invoke an internal function.
 */
export const set = internalMutation({
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
