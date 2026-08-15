import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { getAll } from "convex-helpers/server/relationships";
import { extractMentionedUserIds } from "./utils/blocknote";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { logTaskActivity } from "./auditLog";
import { requireResourceMember, filterWorkspaceRecipients } from "./authHelpers";
import { notify } from "./utils/notify";
import {
  maybeEnqueueCommentCreate,
  maybeEnqueueCommentDelete,
  maybeEnqueueCommentUpdate,
} from "./integrations/core/outboundDispatch";

export const list = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(v.object({
    _id: v.id("taskComments"),
    _creationTime: v.number(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    body: v.string(),
    deleted: v.boolean(),
    author: v.string(),
    image: v.optional(v.string()),
    // GitHub-side identity for comments inserted by the integration's
    // inbound sync. Absent for Ripple-native comments. Rendered as a chip
    // alongside the bot-user avatar so external contributors are visible
    // without pretending they are Ripple members.
    externalAuthor: v.optional(v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    })),
  })),
  handler: async (ctx, { taskId }) => {
    await requireResourceMember(ctx, "tasks", taskId);

    // Query comments using undeleted_by_task index
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("undeleted_by_task", (q) =>
        q.eq("taskId", taskId).eq("deleted", false)
      )
      .order("asc") // chronological order (oldest first)
      .collect();

    // Batch fetch all authors
    const userIds = [...new Set(comments.map((c) => c.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Per-comment integration link lookup for the external author chip.
    // The link table is small per-task; a query-per-comment is fine.
    const externalAuthorByComment = new Map<
      typeof comments[number]["_id"],
      { login: string; avatarUrl: string; url: string }
    >();
    for (const c of comments) {
      const link = await ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_taskComment", (q) => q.eq("taskCommentId", c._id))
        .unique();
      // Only inbound (external-authored) comments carry an `externalAuthor`.
      // Ripple-originated comments have a link row but no external author, so
      // they keep their real author's avatar instead of the bot chip.
      if (link?.externalAuthor)
        externalAuthorByComment.set(c._id, link.externalAuthor);
    }

    // Enrich comments with author info. Pick fields explicitly rather than
    // spreading `comment` so internal columns (e.g. `lastSyncError`, which the
    // outbound push may set) don't leak past the return validator — the client
    // reads comment sync state from the task link, not from each comment row.
    const enrichedComments = comments.map((comment) => {
      const user = userMap.get(comment.userId);
      return {
        _id: comment._id,
        _creationTime: comment._creationTime,
        taskId: comment.taskId,
        userId: comment.userId,
        body: comment.body,
        deleted: comment.deleted,
        author: getUserDisplayName(user),
        image: user?.image,
        externalAuthor: externalAuthorByComment.get(comment._id),
      };
    });

    return enrichedComments;
  },
});

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    /** BlockNote JSON — Ripple's canonical representation, stored and rendered. */
    body: v.string(),
    /**
     * The same content rendered to markdown by the client editor, for the
     * outbound GitHub push. BlockNote→markdown is lossy for Ripple-only inline
     * content (mentions), matching the description-sync contract; we render it
     * client-side because Convex can't carry the BlockNote/JSDOM bundle. Not
     * stored — only threaded to the outbound dispatcher.
     */
    bodyMarkdown: v.string(),
  },
  returns: v.id("taskComments"),
  handler: async (ctx, { taskId, body, bodyMarkdown }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    // Insert comment
    const commentId = await ctx.db.insert("taskComments", {
      taskId,
      userId,
      body,
      deleted: false,
    });

    // Log comment creation activity
    await logTaskActivity(ctx, {
      taskId,
      userId,
      workspaceId: task.workspaceId,
      type: "comment_create",
      taskTitle: task.title,
    });

    // Schedule mention notifications after database write. The ids come out of
    // a client-authored body, so they are narrowed to the task's workspace
    // before they become recipients — the push carries the task's title.
    const mentionedUserIds = extractMentionedUserIds(body);
    const filteredMentions = await filterWorkspaceRecipients(
      ctx,
      task.workspaceId,
      mentionedUserIds.filter(id => id !== userId),
    );
    const user = await ctx.db.get(userId);

    if (filteredMentions.length > 0) {
      await notify(ctx, {
        category: "taskCommentMention",
        userId,
        userName: getUserDisplayName(user),
        recipientIds: filteredMentions,
        resourceId: task.projectId,
        title: `${getUserDisplayName(user)} mentioned you`,
        body: `In comment for: ${task?.title ?? "a task"}`,
        url: `/workspaces/${task?.workspaceId}/projects/${task?.projectId}?task=${taskId}`,
      });
    }

    // Notify assignee about new comment (if they're not the commenter and not already mentioned)
    if (task.assigneeId && task.assigneeId !== userId && !filteredMentions.includes(task.assigneeId)) {
      await notify(ctx, {
        category: "taskComment",
        userId,
        userName: getUserDisplayName(user),
        recipientIds: [task.assigneeId],
        resourceId: task.projectId,
        title: `${getUserDisplayName(user)} commented on your task`,
        body: task.title,
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      });
    }

    await maybeEnqueueCommentCreate(ctx, commentId, bodyMarkdown);

    return commentId;
  },
});

/**
 * Editing and deleting take the task's workspace rule first and authorship
 * second, matching `create` above. Authorship alone is not an access rule (see
 * CLAUDE.md — there are exactly two), and here it was standing in for one: a
 * user removed from the workspace could still rewrite and delete their comments
 * on tasks they can no longer read, and — because both handlers dispatch
 * outbound — make Ripple push that edit or delete to the linked GitHub/GitLab
 * issue under the installation's credentials.
 *
 * `requireResourceMember` returns the task, so the activity log and the mention
 * fan-out read it from there rather than re-fetching it with a `!`.
 */
export const update = mutation({
  args: {
    id: v.id("taskComments"),
    /** BlockNote JSON — see `create`. */
    body: v.string(),
    /** Markdown rendering for the outbound GitHub push — see `create`. */
    bodyMarkdown: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, body, bodyMarkdown }) => {
    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", comment.taskId);

    // Author-only check, narrowing the workspace rule rather than replacing it
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Update body with trimmed value
    await ctx.db.patch(id, { body: body.trim() });

    await maybeEnqueueCommentUpdate(ctx, id, bodyMarkdown);

    // Log comment edit activity
    await logTaskActivity(ctx, { taskId: comment.taskId, userId, workspaceId: task.workspaceId, type: "comment_edit", taskTitle: task.title });

    // Schedule mention notifications for newly added mentions after database write
    const oldMentions = new Set(comment.body ? extractMentionedUserIds(comment.body) : []);
    const newMentions = extractMentionedUserIds(body);
    const addedMentions = await filterWorkspaceRecipients(
      ctx,
      task.workspaceId,
      newMentions.filter(id => !oldMentions.has(id) && id !== userId),
    );
    if (addedMentions.length > 0) {
      const user = await ctx.db.get(userId);
      await notify(ctx, {
        category: "taskCommentMention",
        userId,
        userName: getUserDisplayName(user),
        recipientIds: addedMentions,
        resourceId: task.projectId,
        title: `${getUserDisplayName(user)} mentioned you`,
        body: `In comment for: ${task.title}`,
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${comment.taskId}`,
      });
    }

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("taskComments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", comment.taskId);

    // Author-only check, narrowing the workspace rule rather than replacing it
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Soft delete
    await ctx.db.patch(id, { deleted: true });

    await maybeEnqueueCommentDelete(ctx, id);

    // Log comment delete activity
    await logTaskActivity(ctx, { taskId: comment.taskId, userId, workspaceId: task.workspaceId, type: "comment_delete", taskTitle: task.title });

    return null;
  },
});

/**
 * Replace an inbound comment's raw markdown body with its BlockNote JSON
 * rendering. Called by `integrations/core/commentSeedAction.seedCommentBody`
 * after the headless markdown→blocks conversion.
 *
 * Guarded against clobbering a newer state: the patch only lands if `body` is
 * still the exact markdown we converted. A subsequent inbound edit/delete (or a
 * redelivery) replaces `body` and schedules its own conversion, so a stale
 * conversion that resolves late simply no-ops. Idempotent for the same reason —
 * once `body` is the JSON, it no longer equals `sourceMarkdown`.
 */
export const setBodyFromMarkdown = internalMutation({
  args: {
    commentId: v.id("taskComments"),
    json: v.string(),
    sourceMarkdown: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { commentId, json, sourceMarkdown }) => {
    const comment = await ctx.db.get(commentId);
    if (!comment) return null;
    if (comment.body !== sourceMarkdown) return null;
    await ctx.db.patch(commentId, { body: json });
    return null;
  },
});
