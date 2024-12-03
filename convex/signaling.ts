import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Store signaling messages in a database table
export const sendSignal = mutation({
  args: {
    roomId: v.string(),
    signal: v.object({
      type: v.string(),
      data: v.any(),
    }),
  },
  handler: async (ctx, { roomId, signal }) => {
    await ctx.db.insert("signals", {
      roomId,
      signal,
    });
  },
});

export const getSignals = query({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    return await ctx.db
      .query("signals")
      .filter((q) => q.eq(q.field("roomId"), roomId))
      .order("desc")
      .collect();
  },
});
