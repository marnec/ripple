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
    const signal = await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(q.eq(q.field("roomId"), roomId), q.eq(q.field("userId"), userId)),
      )
      .first();

    if (!signal)
      throw new Error(
        `Signal not found for room=${roomId} and user=${userId}`,
      );

    await ctx.db.delete(signal._id);
  },
});

export const getPeersSignals = query({
  args: {
    roomId: v.string(),
    type: v.string(),
  },
  handler: async (ctx, { roomId, type }) => {
    let myself = await ctx.auth.getUserIdentity();

    if (!myself) throw new Error("User not authenticated");

    return await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.eq(q.field("roomId"), roomId),
          q.eq(q.field("type"), type),
          q.neq(q.field("userId"), myself.id),
        ),
      )
      .order("desc")
      .collect();
  },
});
