import { v } from "convex/values";
import { internalMutation } from "./functions";

/**
 * Token accounting for model calls, written by the usage handler every agent
 * carries (`lib/aiAgents.ts`).
 *
 * The row is the unit the provider bills: one per step, not one per user
 * request. Cache reads and writes are kept apart from plain input tokens
 * because they are priced differently, so a row that collapsed them could not
 * be costed after the fact.
 *
 * Nothing reads this yet — it exists so that the answer to "what did this
 * workspace spend" is a query rather than an archaeology project. It is the
 * only metering the document assistant has: that route is an HTTP action, so
 * it passes through neither `aiPool` nor the `assistantReply` rate limit.
 */
export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.id("users")),
    surface: v.string(),
    provider: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("aiUsage", args);
    return null;
  },
});
