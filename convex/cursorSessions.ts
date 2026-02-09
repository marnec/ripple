import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const getActiveSession = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { documentId }) => {
    return await ctx.db
      .query("cursorSessions")
      .withIndex("by_document_active", (q) =>
        q.eq("documentId", documentId).eq("active", true),
      )
      .first();
  },
});

export const createSession = internalMutation({
  args: {
    documentId: v.id("documents"),
    cloudflareMeetingId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, cloudflareMeetingId }) => {
    await ctx.db.insert("cursorSessions", {
      documentId,
      cloudflareMeetingId,
      active: true,
    });
    return null;
  },
});

export const deactivateSession = internalMutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, { documentId }) => {
    const sessions = await ctx.db
      .query("cursorSessions")
      .withIndex("by_document_active", (q) =>
        q.eq("documentId", documentId).eq("active", true),
      )
      .collect();
    for (const session of sessions) {
      await ctx.db.patch(session._id, { active: false });
    }
    return null;
  },
});

export const joinCursorSession = action({
  args: {
    documentId: v.id("documents"),
    userName: v.string(),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
  }),
  handler: async (ctx, { documentId, userName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const appId = process.env.CLOUDFLARE_RTK_APP_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !appId || !apiToken) {
      throw new Error(
        "Missing Cloudflare RealtimeKit environment variables.",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const addParticipant = async (meetingId: string) => {
      const res = await fetch(
        `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings/${meetingId}/participants`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: userName,
            preset_name: "group_call_host",
            custom_participant_id: userId,
          }),
        },
      );
      return res;
    };

    // Check for an existing active session
    const session = await ctx.runQuery(
      internal.cursorSessions.getActiveSession,
      { documentId },
    );

    let meetingId: string;

    if (session) {
      meetingId = session.cloudflareMeetingId;

      // Try adding participant to existing meeting
      const res = await addParticipant(meetingId);
      if (res.ok) {
        const data = await res.json();
        const authToken = (data as { data: { token: string } }).data.token;
        return { authToken, meetingId };
      }

      // Stale session — mark inactive and create fresh
      await ctx.runMutation(internal.cursorSessions.deactivateSession, {
        documentId,
      });
    }

    // Create a new meeting
    const createRes = await fetch(
      `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ title: `Cursor ${documentId}` }),
      },
    );

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create cursor meeting: ${err}`);
    }

    const createData = await createRes.json();
    meetingId = (createData as { data: { id: string } }).data.id;

    await ctx.runMutation(internal.cursorSessions.createSession, {
      documentId,
      cloudflareMeetingId: meetingId,
    });

    const participantRes = await addParticipant(meetingId);
    if (!participantRes.ok) {
      const err = await participantRes.text();
      throw new Error(`Failed to add cursor participant: ${err}`);
    }

    const participantData = await participantRes.json();
    const authToken = (participantData as { data: { token: string } }).data
      .token;

    return { authToken, meetingId };
  },
});
