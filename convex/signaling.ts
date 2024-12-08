import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Store signaling messages in a database table
export const sendRoomSignal = mutation({
  args: {
    roomId: v.string(),
    userId: v.id("users"),
    type: v.optional(v.string()),
    sdp: v.optional(v.any()),
    candidate: v.optional(v.any()),
  },
  handler: async (ctx, { roomId, userId, type, sdp, candidate }) => {
    return ctx.db.insert("signals", {
      roomId,
      userId,
      type,
      sdp,
      candidate,
    });
  },
});

export const deleteRoomSignal = mutation({
  args: { roomId: v.string(), userId: v.id("users") },
  handler: async (ctx, { roomId, userId }) => {
    const signals = await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(q.eq(q.field("roomId"), roomId), q.eq(q.field("userId"), userId)),
      )
      .collect();

    if (!signals?.length)
      throw new Error(`No signals found for room=${roomId} and user=${userId}`);

    return Promise.all(signals.map(({ _id }) => ctx.db.delete(_id)));
  },
});

export const getSignals = query({
  args: {
    roomId: v.string(),
    type: v.string(),
  },
  handler: async (ctx, { roomId, type }) => {
    return await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.eq(q.field("roomId"), roomId),
          q.eq(q.field("type"), type)
        ),
      )
      .order("desc")
      .collect();
  },
});
