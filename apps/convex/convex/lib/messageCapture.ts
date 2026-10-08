import { ConvexError, v, type Infer } from "convex/values";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getAll } from "convex-helpers/server/relationships";
import { requireChannelAccess } from "../authHelpers";
import { ChannelKind } from "@ripple/shared/enums";
import { extractProjectIds } from "../utils/blocknote";
import { normalizeIds } from "../utils/ids";

/**
 * Turning chat messages into a task's opening comments ("Create task" with
 * messages selected). A copy, taken once at creation — not a sync: an edit or
 * delete in chat afterwards does not reach the task. `quotedFrom.messageId`
 * keeps the way back to the original.
 *
 * Copying publishes. The task is under the workspace rule, so a closed-channel
 * or DM message becomes readable by every workspace member — which is why the
 * capturer must be able to read the channel, and why the copies are always the
 * private lane (`internal`): chat was never written for a GitHub issue, and an
 * internal comment is never pushed, even if the task is linked later.
 */

/** Ceiling on messages per capture — the same bound chat reads use. */
export const CAPTURE_MAX = 50;

type Block = {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
  [key: string]: unknown;
};

type Inline = { type: string; props?: Record<string, unknown>; content?: Inline[]; [key: string]: unknown };

/**
 * A channel message's BlockNote body re-expressed in the task-comment schema,
 * which is chat's minus the reference inline content and with uploads as
 * trailing `file` blocks (`commentAttachments.ts`):
 *
 *  - `taskMention`, `projectReference`, `resourceReference` → plain `#name`
 *    text. A comment cannot hold them, and they read the same as text.
 *  - `userMention`, `eventMention` → kept; the comment schema has both.
 *  - `image` → a `file` attachment of the full-size upload. `file` is kept.
 *
 * A body that is not BlockNote JSON becomes one paragraph of its plain text.
 */
export function messageBodyToCommentBody(
  body: string,
  plainText: string,
  projectNames: ReadonlyMap<string, string>,
): string {
  let blocks: Block[];
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) throw new Error("not blocks");
    blocks = parsed as Block[];
  } catch {
    return JSON.stringify([
      { type: "paragraph", content: [{ type: "text", text: plainText, styles: {} }] },
    ]);
  }

  const asText = (text: string): Inline => ({ type: "text", text, styles: {} });

  const convertInline = (items: Inline[]): Inline[] =>
    items.map((item) => {
      const props = item.props ?? {};
      switch (item.type) {
        case "taskMention":
          return asText(`#${(props.taskTitle as string) || "task"}`);
        case "projectReference":
          return asText(`#${projectNames.get(props.projectId as string) ?? "project"}`);
        case "resourceReference":
          return asText(`#${(props.resourceName as string) || "resource"}`);
        case "link":
          return { ...item, content: convertInline(item.content ?? []) };
        default:
          return item;
      }
    });

  const convertBlock = (block: Block): Block => ({
    ...block,
    ...(Array.isArray(block.content) ? { content: convertInline(block.content as Inline[]) } : {}),
    ...(block.children ? { children: block.children.map(convertBlock) } : {}),
  });

  const text: Block[] = [];
  const attachments: Block[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      const props = block.props ?? {};
      const url = (props.fullUrl as string) || (props.url as string);
      if (url) {
        attachments.push({
          type: "file",
          props: { url, name: (props.diagramName as string) || "image" },
        });
      }
    } else if (block.type === "file") {
      attachments.push(block);
    } else {
      text.push(convertBlock(block));
    }
  }
  return JSON.stringify([...text, ...attachments]);
}

/**
 * Copy `messageIds` onto `taskId` as comments, oldest first, and mark each
 * message as captured. All messages must come from one channel the caller can
 * read, in `workspaceId`. Throws otherwise — the caller's transaction (the
 * task insert included) rolls back with it.
 *
 * Written as plain inserts rather than through `taskComments.create`: these
 * are not new speech, so they log no comment activity and re-send no mention
 * notifications — the people mentioned were told when the message was sent.
 */
export async function captureMessagesIntoTask(
  ctx: MutationCtx,
  opts: {
    taskId: Id<"tasks">;
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    messageIds: Id<"messages">[];
  },
): Promise<void> {
  const ids = [...new Set(opts.messageIds)];
  if (ids.length === 0) return;
  if (ids.length > CAPTURE_MAX) {
    throw new ConvexError(`At most ${CAPTURE_MAX} messages can be added to a task`);
  }

  const loaded = await getAll(ctx.db, ids);
  const messages: Doc<"messages">[] = [];
  for (const m of loaded) {
    if (!m || m.deleted) throw new ConvexError("Message not found");
    messages.push(m);
  }
  const channelId = messages[0].channelId;
  if (messages.some((m) => m.channelId !== channelId)) {
    throw new ConvexError("Messages must come from one channel");
  }
  const { channel } = await requireChannelAccess(ctx, channelId);
  if (channel.workspaceId !== opts.workspaceId) {
    throw new ConvexError("Messages do not belong to this workspace");
  }
  const isDm = channel.kind === ChannelKind.DM;

  // `#project` chips carry only an id; resolve the names once for the batch,
  // narrowed to this workspace like the chat enrichers.
  const projectIds = normalizeIds(
    ctx.db,
    "projects",
    [...new Set(messages.flatMap((m) => extractProjectIds(m.body)))],
  );
  const projects = await getAll(ctx.db, projectIds);
  const projectNames = new Map<string, string>();
  projects.forEach((p, i) => {
    if (p && p.workspaceId === opts.workspaceId) projectNames.set(projectIds[i], p.name);
  });

  messages.sort((a, b) => a._creationTime - b._creationTime);
  for (const message of messages) {
    await ctx.db.insert("taskComments", {
      taskId: opts.taskId,
      userId: opts.userId,
      body: messageBodyToCommentBody(message.body, message.plainText, projectNames),
      deleted: false,
      internal: true,
      quotedFrom: {
        messageId: message._id,
        authorId: message.userId,
        channelId,
        ...(isDm ? {} : { channelName: channel.name }),
        sentAt: message._creationTime,
      },
    });
    await ctx.db.patch(message._id, { capturedTaskId: opts.taskId });
  }
}

/** What the timeline shows above a captured comment: who said it, where, when. */
export const quotedFromViewValidator = v.object({
  messageId: v.id("messages"),
  channelId: v.id("channels"),
  // Absent for a DM.
  channelName: v.optional(v.string()),
  sentAt: v.number(),
  authorName: v.string(),
  authorImage: v.optional(v.string()),
});

/** Users a batch of comments needs resolved for their `quotedFrom` headers. */
export function quotedAuthorIds(comments: Doc<"taskComments">[]): Id<"users">[] {
  return comments.flatMap((c) => (c.quotedFrom ? [c.quotedFrom.authorId] : []));
}

export function quotedFromView(
  comment: Doc<"taskComments">,
  userMap: ReadonlyMap<string, Doc<"users"> | null>,
): Infer<typeof quotedFromViewValidator> | undefined {
  const q = comment.quotedFrom;
  if (!q) return undefined;
  const author = userMap.get(q.authorId);
  return {
    messageId: q.messageId,
    channelId: q.channelId,
    channelName: q.channelName,
    sentAt: q.sentAt,
    authorName: getUserDisplayName(author),
    authorImage: author?.image,
  };
}
