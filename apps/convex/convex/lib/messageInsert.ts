import { getAll } from "convex-helpers/server/relationships";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "../_generated/server";
import { filterChannelRecipients } from "../authHelpers";
import {
  extractEventMentionIds,
  extractEventSeriesMentionIds,
  extractMentionedUserIds,
  extractPlainTextFromBody,
  extractProjectIds,
} from "../utils/blocknote";
import { normalizeIds } from "../utils/ids";
import { notify } from "../utils/notify";
import { mentionTitle } from "./mentionTitle";

/**
 * Writing a message into a channel, for every author that does it: a person
 * through `messages.send`, the workspace assistant through
 * `chatAssistant.postReply`. One function so the two rows are shaped alike and
 * the notifications that follow are decided alike — the mention list goes
 * through the channel rule here, whoever wrote it.
 *
 * Access is the caller's job. `send` has already applied the channel rule to
 * its sender and checked the reply parent; the assistant answers only where
 * it was summoned. This function trusts `channel` and `author` as given.
 */
export async function insertMessage(
  ctx: MutationCtx,
  args: {
    author: Doc<"users">;
    channel: Doc<"channels">;
    body: string;
    plainText: string;
    isomorphicId: string;
    replyToId?: Id<"messages">;
  },
): Promise<Id<"messages">> {
  const { author, channel, body, plainText, isomorphicId, replyToId } = args;
  const authorName = getUserDisplayName(author);
  const url = `/workspaces/${channel.workspaceId}/channels/${channel._id}`;

  const messageId = await ctx.db.insert("messages", {
    body,
    userId: author._id,
    channelId: channel._id,
    plainText,
    isomorphicId,
    deleted: false,
    replyToId,
  });

  // What every push below says, read out of the stored body — never out of
  // the `plainText` arg, which travels beside `body` and need not agree with it.
  const pushText = await messageTextFromBody(ctx, body, channel.workspaceId);

  // Extract @mentions and schedule chat mention notifications. The mention
  // list decides who receives the message's opening lines, so it goes through
  // the channel rule before it reaches `notify` — the composer's @-picker is
  // fed workspace members, which in a closed channel or DM is a wider set.
  const mentionedUserIds = extractMentionedUserIds(body).filter(
    (id) => id !== author._id,
  );
  const mentionRecipients = await filterChannelRecipients(
    ctx,
    channel,
    mentionedUserIds,
  );

  if (mentionRecipients.length > 0) {
    await notify(ctx, {
      category: "chatMention",
      userId: author._id,
      userName: authorName,
      recipientIds: mentionRecipients,
      resourceId: channel._id,
      title: mentionTitle(authorName, channel),
      body: pushText.length > 100 ? pushText.slice(0, 97) + "..." : pushText,
      url,
    });
  }

  await notify(ctx, {
    category: "chatChannelMessage",
    userId: author._id,
    userName: authorName,
    scope: channel._id,
    title: authorName,
    body: pushText,
    url,
  });

  return messageId;
}

/**
 * The text a message reads as outside the composer — on a lock screen, in the
 * transcript the assistant is given — read out of its body.
 *
 * `body` and `plainText` are independent args on `send` — the client composes
 * both and nothing makes them agree — so taking the notification from
 * `plainText` lets a sender put one thing in the channel and a different thing
 * on every recipient's lock screen. Everything here comes from `body`, resolved
 * through the same name maps `enrichWithReplyTo` builds so the preview reads
 * "@Alice" rather than "@user".
 *
 * A snapshot-only message has no text at all; its label is the diagram name the
 * composer wrote onto the image block, which is part of `body` too — so the
 * empty case doesn't have to fall back to the untrusted arg.
 *
 * The `workspaceId` comparisons are the same guard the read path carries: this
 * is the one place a foreign name escapes the app entirely, onto a lock screen,
 * so a project or event the sender pasted from another tenant renders as the
 * raw mention rather than its title.
 */
export async function messageTextFromBody(
  ctx: { db: DatabaseReader },
  body: string,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const userIds = normalizeIds(ctx.db, "users", extractMentionedUserIds(body));
  const projectIds = normalizeIds(ctx.db, "projects", extractProjectIds(body));
  const eventIds = normalizeIds(ctx.db, "calendarEvents", extractEventMentionIds(body));
  const seriesIds = normalizeIds(
    ctx.db,
    "eventSeries",
    extractEventSeriesMentionIds(body),
  );

  const userNames = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await getAll(ctx.db, userIds);
    users.forEach((u, i) => {
      if (u) userNames.set(userIds[i], getUserDisplayName(u));
    });
  }

  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const projects = await getAll(ctx.db, projectIds);
    projects.forEach((p, i) => {
      if (p && p.workspaceId === workspaceId) projectNames.set(projectIds[i], p.name);
    });
  }

  // Events and series share one map because they share one chip: the
  // projection looks up whichever id the mention carries, and the two id
  // spaces cannot collide.
  const eventTitles = new Map<string, string>();
  if (eventIds.length > 0) {
    const events = await getAll(ctx.db, eventIds);
    events.forEach((e, i) => {
      if (e && e.workspaceId === workspaceId) eventTitles.set(eventIds[i], e.title);
    });
  }
  if (seriesIds.length > 0) {
    const series = await getAll(ctx.db, seriesIds);
    series.forEach((s, i) => {
      if (s && s.workspaceId === workspaceId) eventTitles.set(seriesIds[i], s.title);
    });
  }

  const text = extractPlainTextFromBody(body, userNames, projectNames, eventTitles);
  return text || attachmentLabelFromBody(body);
}

/**
 * What to call a message that is nothing but an attachment: the diagram name a
 * snapshot carries, or the file name of a file attachment. Both are the only
 * words such a message has, so they are what a reply preview and a lock screen
 * show instead of an empty line.
 */
function attachmentLabelFromBody(body: string): string {
  try {
    const blocks: { type: string; props?: { diagramName?: string; name?: string } }[] =
      JSON.parse(body);
    const diagramName = blocks.find((b) => b.type === "image")?.props?.diagramName;
    if (diagramName) return diagramName;
    return blocks.find((b) => b.type === "file")?.props?.name ?? "";
  } catch {
    // non-JSON body — nothing to label it with
    return "";
  }
}
