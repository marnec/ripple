import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireUser } from "./authHelpers";

export const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Race-safe wrapper that returns the Cloudflare meetingId for a channel.
 *
 * The race: two parallel callers both see `getActiveSession` return null,
 * both POST to Cloudflare to create a meeting, both try to persist. Only
 * one `createSession` mutation wins — the loser's CF meeting is orphaned
 * and burns quota until CF idle-cleans it.
 *
 * Fix: if we lose the race (createSession returns the winner's id instead
 * of null), DELETE our orphan on Cloudflare. Fire-and-forget; a failed
 * cleanup logs to console but does not fail the join.
 */
export async function ensureMeetingForChannel(
  ctx: ActionCtx,
  channelId: Id<"channels">,
  cf: { accountId: string; appId: string; apiToken: string },
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${cf.apiToken}`,
    "Content-Type": "application/json",
  };

  const session = await ctx.runQuery(internal.callSessions.getActiveSession, {
    channelId,
  });
  if (session) return session.cloudflareMeetingId;

  const createRes = await fetch(
    `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ title: `Channel call ${channelId}` }),
    },
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    console.error("Cloudflare create-meeting failed:", createRes.status, err);
    throw new Error("Could not start the call");
  }
  const createData = (await createRes.json()) as { data: { id: string } };
  const ourMeetingId = createData.data.id;

  const winnerMeetingId = await ctx.runMutation(
    internal.callSessions.createSession,
    { channelId, cloudflareMeetingId: ourMeetingId },
  );

  if (winnerMeetingId && winnerMeetingId !== ourMeetingId) {
    // We lost the race — our CF meeting is orphaned. Clean it up so it
    // doesn't tie up Cloudflare participant / meeting quota.
    void fetch(
      `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings/${ourMeetingId}`,
      { method: "DELETE", headers },
    ).catch((e) => console.error("Orphan meeting cleanup failed:", e));
    return winnerMeetingId;
  }
  return ourMeetingId;
}

const callSessionValidator = v.object({
  _id: v.id("callSessions"),
  _creationTime: v.number(),
  channelId: v.id("channels"),
  cloudflareMeetingId: v.string(),
  active: v.boolean(),
});

export const getActiveSession = internalQuery({
  args: { channelId: v.id("channels") },
  returns: v.union(callSessionValidator, v.null()),
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
    await requireUser(ctx);

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

    const meetingId = await ensureMeetingForChannel(ctx, channelId, {
      accountId,
      appId,
      apiToken,
    });

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
