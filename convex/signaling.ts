import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Store signaling messages in a database table
export const sendRoomSignal = mutation({
  args: {
    roomId: v.string(),
    userId: v.id("users"),
    type: v.string(),
    sdp: v.any(),
    candidates: v.array(v.string()),
  },
  handler: async (ctx, { roomId, userId, type, sdp, candidates }) => {
    return ctx.db.insert("signals", {
      roomId,
      userId,
      type,
      sdp,
      candidates,
    });
  },
});

export const deleteRoomSignal = mutation({
  args: { roomId: v.string(), userId: v.id("users"), type: v.string() },
  handler: async (ctx, { roomId, userId, type }) => {
    const signal = await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.eq(q.field("roomId"), roomId),
          q.eq(q.field("userId"), userId),
          q.eq(q.field("type"), type),
        ),
      )
      .first();

    if (!signal)
      throw new Error(
        `Signal of type=${type} not found for room=${roomId} and user=${userId}`,
      );

    await ctx.db.delete(signal._id);
  },
});

export const sendCandidate = mutation({
  args: {
    id: v.id("signals"),
    candidate: v.any(),
  },
  handler: async (ctx, { id, candidate }) => {
    const signal = await ctx.db.get(id);

    if (!signal) throw new Error(`Signal not found with id ${id}`);

    let candidates = [...signal.candidates, candidate];

    ctx.db.patch(id, { candidates });
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
      .filter((q) => q.eq(q.field("roomId"), roomId))
      .filter((q) => q.eq(q.field("type"), type))
      .order("desc")
      .collect();
  },
});
