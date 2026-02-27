import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";

const getActiveSessionRef = makeFunctionReference<
  "query",
  { channelId: Id<"channels"> }
>("callSessions:getActiveSession");

const createSessionRef = makeFunctionReference<
  "mutation",
  { channelId: Id<"channels">; cloudflareMeetingId: string },
  string
>("callSessions:createSession");

const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const getActiveSession = internalQuery({
  args: { channelId: v.id("channels") },
  returns: v.any(),
  handler: async (ctx, { channelId }) => {
    return await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .first();
  },
});

export const createSession = internalMutation({
  args: {
    channelId: v.id("channels"),
    cloudflareMeetingId: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { channelId, cloudflareMeetingId }) => {
    // Check inside the mutation (transactional) to prevent duplicate sessions
    const existing = await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .first();

    if (existing) {
      return existing.cloudflareMeetingId;
    }

    await ctx.db.insert("callSessions", {
      channelId,
      cloudflareMeetingId,
      active: true,
    });
    return null;
  },
});

export const endSession = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const sessions = await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .collect();

    for (const session of sessions) {
      await ctx.db.patch(session._id, { active: false });
    }
    return null;
  },
});

export const joinCall = action({
  args: {
    channelId: v.id("channels"),
    userName: v.string(),
    userImage: v.optional(v.string()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
  }),
  handler: async (ctx, { channelId, userName, userImage }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const appId = process.env.CLOUDFLARE_RTK_APP_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !appId || !apiToken) {
      throw new Error(
        "Missing Cloudflare RealtimeKit environment variables. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_RTK_APP_ID, and CLOUDFLARE_API_TOKEN.",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // Check for an existing active session
    const session = await ctx.runQuery(getActiveSessionRef, {
      channelId,
    });
    let meetingId: string;

    if (session) {
      meetingId = session.cloudflareMeetingId;
    } else {
      // Create a new meeting
      const createRes = await fetch(
        `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ title: `Channel call ${channelId}` }),
        },
      );

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Failed to create Cloudflare meeting: ${err}`);
      }

      const createData = await createRes.json();
      meetingId = (createData as { data: { id: string } }).data.id;

      // Store the session — if another user raced us, use their session instead
      const existingMeetingId = await ctx.runMutation(
        createSessionRef,
        {
          channelId,
          cloudflareMeetingId: meetingId,
        },
      );

      if (existingMeetingId) {
        meetingId = existingMeetingId;
      }
    }

    // Add this user as a participant
    const participantRes = await fetch(
      `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: userName,
          picture: userImage,
          preset_name: "group_call_host",
          custom_participant_id: userId,
        }),
      },
    );

    if (!participantRes.ok) {
      const err = await participantRes.text();
      throw new Error(`Failed to add participant: ${err}`);
    }

    const participantData = await participantRes.json();
    const authToken = (participantData as { data: { token: string } }).data
      .token;

    return { authToken, meetingId };
  },
});
