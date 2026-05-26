import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAll } from "convex-helpers/server/relationships";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { Id } from "./_generated/dataModel";
import { auditLog } from "./auditLog";
import { checkResourceMember } from "./authHelpers";

type AuditEntry = {
  _id: string;
  _creationTime: number;
  action: string;
  actorId?: string;
  timestamp: number;
  metadata?: unknown;
};

// Returns a merged timeline of audit log activity events and comments, sorted chronologically.
const timelineItemValidator = v.union(
  v.object({
    kind: v.literal("activity"),
    _id: v.string(),
    _creationTime: v.number(),
    userId: v.string(),
    userName: v.string(),
    userImage: v.optional(v.string()),
    type: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("comment"),
    _id: v.id("taskComments"),
    _creationTime: v.number(),
    userId: v.id("users"),
    userName: v.string(),
    userImage: v.optional(v.string()),
    commentId: v.id("taskComments"),
    body: v.string(),
  }),
);

export const timeline = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(timelineItemValidator),
  handler: async (ctx, { taskId }) => {
    // Soft gate (same as `tasks.get`): return [] if the task is gone — e.g.
    // just deleted while the detail sheet's subscription is still live —
    // rather than throwing "task not found".
    const access = await checkResourceMember(ctx, "tasks", taskId);
    if (!access) return [];

    // Fetch activity entries from audit log component
    const auditEntries: AuditEntry[] = await auditLog.queryByResource(ctx, {
      resourceType: "tasks",
      resourceId: taskId,
      limit: 200,
    });

    // Fetch undeleted comments
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("undeleted_by_task", (q) =>
        q.eq("taskId", taskId).eq("deleted", false)
      )
      .order("asc")
      .collect();

    // Collect all user IDs for batch enrichment
    const auditActorIds = auditEntries
      .map((e) => e.actorId)
      .filter((id): id is string => !!id);
    const allUserIds = [
      ...new Set([
        ...auditActorIds,
        ...comments.map((c) => String(c.userId)),
      ]),
    ] as Id<"users">[];
    const users = await getAll(ctx.db, allUserIds);
    const userMap = new Map(
      users.map((u, i) => [allUserIds[i] as string, u]),
    );

    // Build unified timeline items. Skip `comment_create` audit entries — the comment itself already
    // represents that event in the timeline; the audit row would just duplicate it as a generic "made a change".
    const activityItems = auditEntries.flatMap((entry) => {
      const type = entry.action.startsWith("tasks.") ? entry.action.slice(6) : entry.action;
      if (type === "comment_create") return [];
      const user = entry.actorId ? userMap.get(entry.actorId) : undefined;
      const meta = (entry.metadata ?? {}) as { oldValue?: string; newValue?: string };
      return [{
        kind: "activity" as const,
        _id: entry._id,
        _creationTime: entry.timestamp,
        userId: entry.actorId ?? "",
        userName: getUserDisplayName(user),
        userImage: user?.image,
        type,
        oldValue: meta.oldValue,
        newValue: meta.newValue,
      }];
    });

    const commentItems = comments.map((c) => {
      const user = userMap.get(String(c.userId));
      return {
        kind: "comment" as const,
        _id: c._id,
        _creationTime: c._creationTime,
        userId: c.userId,
        userName: getUserDisplayName(user),
        userImage: user?.image,
        commentId: c._id,
        body: c.body,
      };
    });

    // Merge and sort by creation time
    const timeline = [...activityItems, ...commentItems].sort(
      (a, b) => a._creationTime - b._creationTime,
    );

    return timeline;
  },
});
