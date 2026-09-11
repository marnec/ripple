import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { getAll } from "convex-helpers/server/relationships";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { FeatureKey } from "@ripple/shared/enums";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { scheduleModelCall } from "./aiPool";
import { requireChannelAccess, requireWorkspaceMember } from "./authHelpers";
import { insertJobFailure, vJobContext } from "./backgroundJobFailures";
import { hasFeature } from "./integrations/core/entitlements";
import {
  findWorkspaceAssistant,
  TRANSCRIPT_MAX_MESSAGES,
  type TranscriptEntry,
} from "./lib/chatAssistant";
import { insertMessage, messageTextFromBody } from "./lib/messageInsert";
import { rateLimiter } from "./rateLimits";

/**
 * The workspace assistant in chat: an AI bot that answers when @-mentioned.
 *
 * The flow is three functions in three runtimes. `scheduleAssistantReply`
 * runs inside `messages.send` and decides, in the sender's transaction,
 * whether this message summons the assistant; `chatAssistantAction.reply`
 * (Node, for the markdown conversion) reads its context through
 * `loadReplyContext`, calls the model, and posts the answer through
 * `postReply`, which inserts an ordinary `messages` row authored by the bot
 * user. Nothing the chat UI does distinguishes that row from a person's.
 *
 * Gates, in the order they are applied:
 *  - the mention names *this workspace's* assistant. A bot user belongs to one
 *    workspace (`workspaceAssistants.by_bot_user`); a mention of another
 *    workspace's bot is an inert chip, like any foreign id pasted into a body.
 *  - the `ai_assistant` entitlement is on, checked both when the reply is
 *    queued and again when it runs, so disabling the feature stops replies
 *    that were already waiting.
 *  - the per-workspace `assistantReply` rate limit has budget. A mention past
 *    it is not answered; nothing is queued.
 *
 * The channel rule does not apply to the assistant itself: it is summoned by
 * someone who already passed that rule to post the mention, and it answers
 * only in the channel it was summoned in. What it is *given* is the channel's
 * own messages and nothing else — the transcript in `loadReplyContext` — so a
 * closed channel's content goes to the model, not to another channel.
 *
 * While the reply is on its way the channel shows the assistant as writing.
 * That state is an `assistantPendingReplies` row per queued mention, written
 * in the same transaction that queues it (so it appears with the message) and
 * removed on both ways out: `postReply` when the answer lands, and
 * `replyFinished` — the job's `onComplete` — when it does not, whether the
 * model answered with nothing, the feature was switched off meanwhile, or the
 * job failed for good. `pendingReplies` is the channel's view of those rows.
 */

const assistantValidator = v.object({
  botUserId: v.id("users"),
  name: v.string(),
});

/**
 * The assistant the composer offers in its `@` menu, or null while the
 * feature is off — the picker hides an assistant that would not answer.
 */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), assistantValidator),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    if (!(await hasFeature(ctx, workspaceId, FeatureKey.AI_ASSISTANT))) return null;
    const assistant = await findWorkspaceAssistant(ctx, workspaceId);
    if (!assistant) return null;
    const bot = await ctx.db.get(assistant.botUserId);
    if (!bot) return null;
    return { botUserId: bot._id, name: getUserDisplayName(bot) };
  },
});

/**
 * Called by `messages.send` after the row is written. Returns whether a reply
 * was queued, which is what the tests observe.
 */
export async function scheduleAssistantReply(
  ctx: MutationCtx,
  args: {
    channel: Doc<"channels">;
    messageId: Id<"messages">;
    senderId: Id<"users">;
    mentionedUserIds: string[];
  },
): Promise<boolean> {
  if (args.mentionedUserIds.length === 0) return false;

  const assistant = await findWorkspaceAssistant(ctx, args.channel.workspaceId);
  if (!assistant) return false;
  if (!args.mentionedUserIds.includes(assistant.botUserId)) return false;
  // The assistant never answers itself, whatever its reply happens to contain.
  if (args.senderId === assistant.botUserId) return false;
  if (!(await hasFeature(ctx, args.channel.workspaceId, FeatureKey.AI_ASSISTANT))) {
    return false;
  }

  const { ok } = await rateLimiter.limit(ctx, "assistantReply", {
    key: args.channel.workspaceId,
  });
  if (!ok) return false;

  await ensureChannelThread(ctx, args.channel);
  await ctx.db.insert("assistantPendingReplies", {
    channelId: args.channel._id,
    messageId: args.messageId,
  });
  await scheduleModelCall(
    ctx,
    internal.chatAssistantAction.reply,
    {
      kind: "chatAssistantAction:reply",
      key: args.messageId,
      onComplete: internal.chatAssistant.replyFinished,
    },
    { messageId: args.messageId },
  );
  return true;
}

/**
 * The mentions in a channel the assistant has been queued to answer and has
 * not answered yet — what the chat renders as the assistant writing. Gated by
 * the channel rule like the messages it sits among: who asked and when is
 * channel content.
 */
export const pendingReplies = query({
  args: { channelId: v.id("channels") },
  returns: v.array(
    v.object({
      messageId: v.id("messages"),
      /** When the mention was posted, for the client's staleness guard. */
      since: v.number(),
    }),
  ),
  handler: async (ctx, { channelId }) => {
    await requireChannelAccess(ctx, channelId);
    // A row lives only while its job runs, and the rate limit caps how many
    // jobs a workspace can have queued, so the set is small; the bound is a
    // guard, not a page. Newest first, because that is the one the client's
    // staleness guard reads.
    const rows = await ctx.db
      .query("assistantPendingReplies")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(PENDING_REPLIES_MAX);
    return rows.map((row) => ({ messageId: row.messageId, since: row._creationTime }));
  },
});

/** More than the `assistantReply` bucket can queue at once, with room. */
const PENDING_REPLIES_MAX = 50;

/**
 * Idempotent: both ways out of a reply call it, and either may come first.
 * One row per mention — `scheduleAssistantReply` runs once, in the send that
 * created the message — so `.unique()` is the invariant, not an assumption.
 */
async function clearPendingReply(
  ctx: MutationCtx,
  messageId: Id<"messages">,
): Promise<void> {
  const row = await ctx.db
    .query("assistantPendingReplies")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .unique();
  if (row) await ctx.db.delete(row._id);
}

/**
 * `onComplete` of the reply job. Whatever the outcome, the assistant is no
 * longer writing this answer; a failure is then recorded where every other
 * pool's failures go. Runs in its own transaction after the job's last
 * attempt, so it is the one place a reply that never became a message is
 * guaranteed to be cleared.
 */
export const replyFinished = internalMutation({
  args: vOnCompleteArgs(vJobContext, v.any()),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    const messageId = ctx.db.normalizeId("messages", context.key);
    if (messageId) await clearPendingReply(ctx, messageId);
    if (result.kind === "failed") {
      await insertJobFailure(ctx, {
        kind: context.kind,
        key: context.key,
        error: result.error,
      });
    }
    return null;
  },
});

/**
 * The agent-component thread for a channel, opened on first use. Runs in the
 * mutation that queues the reply, so concurrent first mentions serialize on
 * the row instead of each opening a thread.
 */
async function ensureChannelThread(
  ctx: MutationCtx,
  channel: Doc<"channels">,
): Promise<string> {
  const existing = await ctx.db
    .query("assistantChannelThreads")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .unique();
  if (existing) return existing.threadId;

  const threadId = await createThread(ctx, components.agent, {
    title: channel.name,
  });
  await ctx.db.insert("assistantChannelThreads", {
    channelId: channel._id,
    threadId,
  });
  return threadId;
}

const transcriptEntryValidator = v.object({
  author: v.string(),
  text: v.string(),
  isAssistant: v.boolean(),
  isTrigger: v.boolean(),
});

export const replyContextValidator = v.object({
  channelId: v.id("channels"),
  channelName: v.string(),
  // Carried so the reply action can attribute its token usage without a second
  // read; the channel it comes from is already loaded here.
  workspaceId: v.id("workspaces"),
  workspaceName: v.string(),
  botUserId: v.id("users"),
  botName: v.string(),
  /** Whoever mentioned the assistant. Tools act with this person's access. */
  senderUserId: v.id("users"),
  threadId: v.string(),
  transcript: v.array(transcriptEntryValidator),
});

/**
 * Everything one reply needs, read in one transaction. Null means "do not
 * reply": the message is gone, the feature was switched off meanwhile, or the
 * workspace has no assistant after all.
 *
 * The transcript is the channel since the assistant last spoke — its previous
 * reply and everything before it are already in the thread — capped at
 * `TRANSCRIPT_MAX_MESSAGES`, oldest first, and never past the message being
 * answered: whatever was posted after the mention will be context for the
 * next one.
 */
export const loadReplyContext = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(v.null(), replyContextValidator),
  handler: async (ctx, { messageId }) => {
    const trigger = await ctx.db.get(messageId);
    if (!trigger || trigger.deleted) return null;
    const channel = await ctx.db.get(trigger.channelId);
    if (!channel) return null;
    const workspace = await ctx.db.get(channel.workspaceId);
    if (!workspace) return null;
    if (!(await hasFeature(ctx, channel.workspaceId, FeatureKey.AI_ASSISTANT))) {
      return null;
    }
    const assistant = await findWorkspaceAssistant(ctx, channel.workspaceId);
    if (!assistant) return null;
    const bot = await ctx.db.get(assistant.botUserId);
    if (!bot) return null;
    const thread = await ctx.db
      .query("assistantChannelThreads")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    if (!thread) return null;

    // Newest first, so the walk can stop at the assistant's last reply.
    const window: Doc<"messages">[] = [];
    for await (const message of ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) =>
        q.eq("channelId", channel._id).eq("deleted", false),
      )
      .order("desc")) {
      if (message._creationTime > trigger._creationTime) continue;
      if (message.userId === assistant.botUserId) break;
      window.push(message);
      if (window.length >= TRANSCRIPT_MAX_MESSAGES) break;
    }
    window.reverse();

    const authorIds = [...new Set(window.map((m) => m.userId))];
    const authors = await getAll(ctx.db, authorIds);
    const authorNames = new Map<string, string>();
    authors.forEach((author, i) => {
      if (author) authorNames.set(authorIds[i], getUserDisplayName(author));
    });

    const transcript: TranscriptEntry[] = [];
    for (const message of window) {
      transcript.push({
        author: authorNames.get(message.userId) ?? "Former member",
        text: await messageTextFromBody(ctx, message.body, channel.workspaceId),
        isAssistant: message.userId === assistant.botUserId,
        isTrigger: message._id === trigger._id,
      });
    }

    return {
      channelId: channel._id,
      channelName: channel.name,
      workspaceId: channel.workspaceId,
      workspaceName: workspace.name,
      botUserId: bot._id,
      botName: getUserDisplayName(bot),
      senderUserId: trigger.userId,
      threadId: thread.threadId,
      transcript,
    };
  },
});

/**
 * The answer, as a message in the channel: authored by the bot user and
 * anchored to the mention as a reply, so it reads in context however busy the
 * channel got meanwhile. A mention deleted while the model was working gets no
 * answer — there is nothing left to anchor it to.
 */
export const postReply = internalMutation({
  args: {
    messageId: v.id("messages"),
    body: v.string(),
    plainText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, body, plainText }) => {
    // In the same transaction as the reply, so the channel never shows the
    // assistant as still writing beside the answer it just posted.
    await clearPendingReply(ctx, messageId);
    const trigger = await ctx.db.get(messageId);
    if (!trigger || trigger.deleted) return null;
    const channel = await ctx.db.get(trigger.channelId);
    if (!channel) return null;
    const assistant = await findWorkspaceAssistant(ctx, channel.workspaceId);
    if (!assistant) return null;
    const bot = await ctx.db.get(assistant.botUserId);
    if (!bot) return null;

    await insertMessage(ctx, {
      author: bot,
      channel,
      body,
      plainText,
      isomorphicId: crypto.randomUUID(),
      replyToId: trigger._id,
    });
    return null;
  },
});
