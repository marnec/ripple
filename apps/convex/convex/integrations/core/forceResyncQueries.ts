import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/**
 * Read-only context bundle the force-resync action needs to drive its
 * per-issue REST loop. Resolves:
 *  - the workspaceIntegrations installation id (REST auth)
 *  - the repo's `owner/repo` for path construction
 *  - the list of task-link rows under the project link, joined to each
 *    parent task's `completed` flag and `externalRefs[0].issueNumber`
 *
 * Returns `null` when the link is no longer resync-eligible
 * (disconnected, frozen, or missing). The action treats this as a
 * silent no-op.
 */
export const getResyncContext = internalQuery({
  args: { projectIntegrationLinkId: v.id("projectIntegrationLinks") },
  returns: v.union(
    v.null(),
    v.object({
      installationId: v.string(),
      repoFullName: v.string(),
      items: v.array(
        v.object({
          taskIntegrationLinkId: v.id("taskIntegrationLinks"),
          issueNumber: v.number(),
          completed: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.projectIntegrationLinkId);
    if (!link) return null;
    if (link.status === "disconnected" || link.pausedByBilling) return null;

    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", link.workspaceId),
      )
      .unique();
    if (!integration) return null;

    const taskLinks = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q.eq("projectIntegrationLinkId", args.projectIntegrationLinkId),
      )
      .collect();

    const items: {
      taskIntegrationLinkId: typeof taskLinks[number]["_id"];
      issueNumber: number;
      completed: boolean;
    }[] = [];
    for (const tl of taskLinks) {
      const task = await ctx.db.get(tl.taskId);
      if (!task) continue;
      const issueNumber = task.externalRefs?.[0]?.issueNumber;
      if (issueNumber === undefined) continue;
      items.push({
        taskIntegrationLinkId: tl._id,
        issueNumber,
        completed: task.completed === true,
      });
    }

    return {
      installationId: integration.externalAccountId,
      repoFullName: link.externalRepoFullName,
      items,
    };
  },
});
