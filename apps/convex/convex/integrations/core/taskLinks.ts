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
      // ms timestamp of the upstream issue deletion, when the GitHub issue was
      // deleted. Drives the "issue deleted on GitHub" badge on task detail.
      externalDeletedAt: v.optional(v.number()),
      externalIssueUrl: v.optional(v.string()),
      // The branch Ripple created for this issue, when one exists. Drives the
      // task-detail branch chip + the prefilled "Create pull request" link.
      branchName: v.optional(v.string()),
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
      // True once a genuine USER edit has touched the Yjs description. The
      // GitHub creation-time seed never sets this — so the sync button stays
      // hidden for seed-only content and appears only after a real edit.
      descriptionEdited: v.optional(v.boolean()),
      // Whether a GitHub body was captured at creation (a seed is/was expected).
      // Drives the open-time "block until the seed loads" gate on the client.
      seedExpected: v.boolean(),
      // The task's current description snapshot storage id, or null. Changes
      // (null→id, and id→id when the seed overwrites an empty auto-save) push
      // reactively because this query reads the task doc — the client watches
      // it as the trigger to (re-)hydrate the live doc from the seed. A plain
      // boolean wouldn't surface a content change (empty→seeded), so we expose
      // the id itself.
      descriptionSnapshotId: v.union(v.id("_storage"), v.null()),
      // Reactive seed lifecycle (see schema). The client gate stops waiting on
      // a terminal "seeded"/"skipped"/"failed" rather than an arbitrary timeout.
      // Absent for legacy links / tasks that never scheduled a seed.
      seedStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("seeded"),
          v.literal("skipped"),
          v.literal("failed"),
        ),
      ),
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
      externalDeletedAt: link.externalDeletedAt,
      externalIssueUrl,
      branchName: link.branchName,
      externalAssignees: link.externalAssignees,
      externalClosedBy: link.externalClosedBy,
      descriptionLastSyncedAt: link.descriptionLastSyncedAt,
      descriptionEdited: link.descriptionEdited,
      seedExpected: (link.initialBodyMarkdown?.trim().length ?? 0) > 0,
      descriptionSnapshotId: task?.yjsSnapshotId ?? null,
      seedStatus: link.seedStatus,
    };
  },
});
