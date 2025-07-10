import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Store signaling messages in a database table
export const sendRoomSignal = mutation({
  args: {
    roomId: v.string(),
    peerId: v.string(),
    userId: v.id("users"),
    type: v.optional(v.string()),
    sdp: v.optional(v.any()),
    candidate: v.optional(v.any()),
  },
  handler: async (ctx, { roomId, peerId, userId, type, sdp, candidate }) => {
    return ctx.db.insert("signals", {
      roomId,
      peerId,
      userId,
      type,
      sdp,
      candidate,
    });
  },
});

export const deleteRoomSignal = mutation({
  args: { roomId: v.string(), peerId: v.string() },
  handler: async (ctx, { roomId, peerId }) => {
    const signals = ctx.db
      .query("signals")
      .filter((q) =>
        q.and(q.eq(q.field("roomId"), roomId), q.eq(q.field("peerId"), peerId)),
      );

    let deleted = 0;
    for await (const signal of signals) {
      void ctx.db.delete(signal._id);
      deleted += 1;
    }

    return deleted;
  },
});

export const getOffers = query({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    return await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(q.eq(q.field("roomId"), roomId), q.eq(q.field("type"), "offer")),
      )
      .order("desc")
      .collect();
  },
});

export const getIceCandidates = query({
  args: { roomId: v.string(), excludePeer: v.string() },
  handler: async (ctx, { roomId, excludePeer }) => {
    return ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "ice-candidate"),
          q.eq(q.field("roomId"), roomId),
          q.neq(q.field("peerId"), excludePeer),
        ),
      )
      .collect();
  },
});

export const getAnswers = query({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    const userId = await ctx.auth.getUserIdentity();

    return ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.eq(q.field("roomId"), roomId),
          q.eq(q.field("type"), "answers"),
          q.eq(q.field("candidate"), userId),
        ),
      )
      .order("desc")
      .collect();
  },
});
