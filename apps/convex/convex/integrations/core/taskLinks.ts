import { v } from "convex/values";
import { query } from "../../_generated/server";
import { checkResourceMember } from "../../authHelpers";

/**
 * Per-task integration link state, read only by the task-detail surface
 * (sync chip, future PR badges, future description-sync indicator). Kept
 * separate from `tasks.get` so kanban subscriptions stay off the high-churn
 * `taskIntegrationLinks` table — see the PRD's hot-path discipline.
 */
export const getByTask = query({
  args: { taskId: v.id("tasks") },
  returns: v.union(
    v.null(),
    v.object({
      lastSyncError: v.optional(
        v.object({
          occurredAt: v.number(),
          message: v.string(),
          httpStatus: v.optional(v.number()),
        }),
      ),
      externalState: v.optional(v.union(v.literal("open"), v.literal("closed"))),
      externalIssueUrl: v.optional(v.string()),
      // Display payload for assignees that did NOT win Ripple's single
      // `assigneeId` slot — rendered as muted shadow chips next to the
      // primary assignee on task detail.
      externalAssignees: v.optional(
        v.array(
          v.object({
            login: v.string(),
            avatarUrl: v.string(),
            url: v.string(),
          }),
        ),
      ),
      externalClosedBy: v.optional(
        v.object({
          login: v.string(),
          avatarUrl: v.string(),
          url: v.string(),
        }),
      ),
      // ms timestamp of the last successful Ripple→GitHub description push.
      // Drives the "Last synced X ago" label next to the manual sync button.
      // Absent on tasks whose description has never been pushed (Ripple-native)
      // or whose initial seed predates the push (inbound from GitHub).
      descriptionLastSyncedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { taskId }) => {
    // Auth via the task — readers must be workspace members. Same soft gate
    // `tasks.get` uses: return null if the task is gone (e.g. just deleted while
    // the detail sheet's subscription is still live) rather than throwing.
    const access = await checkResourceMember(ctx, "tasks", taskId);
    if (!access) return null;

    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique();
    if (!link) return null;

    const task = await ctx.db.get(taskId);
    const externalIssueUrl = task?.externalRefs?.[0]?.url;

    return {
      lastSyncError: link.lastSyncError,
      externalState: link.externalState,
      externalIssueUrl,
      externalAssignees: link.externalAssignees,
      externalClosedBy: link.externalClosedBy,
      descriptionLastSyncedAt: link.descriptionLastSyncedAt,
    };
  },
});
