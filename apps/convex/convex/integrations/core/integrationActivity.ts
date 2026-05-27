import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { logActivity } from "../../auditLog";
import {
  getIntegrationForLink,
  getWorkspaceIntegration,
} from "./integrationLookups";

/**
 * Append an integration-sourced entry to a task's activity timeline. Unlike
 * `logTaskActivity` (which records a Ripple user's own edit), these events are
 * driven by the integration — either an inbound GitHub webhook (PR merged,
 * issue closed → status synced) or a Ripple-initiated outbound op ("create
 * issue", "create branch"). They're tagged `source: "integration"` so the
 * task detail's Integration tab can filter to them, and actored to the
 * workspace's integration bot user (the closest stand-in for a system actor —
 * the same convention the outbound failure recorders already use).
 *
 * Self-contained: resolves the workspace + bot user from the task alone, so any
 * mutation holding only a `taskId` can call it. Best-effort — `logActivity`
 * swallows its own write failures, and a missing task/integration is a silent
 * no-op rather than an error (logging must never abort the sync mutation).
 */
export async function logTaskIntegrationActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    type: string;
    oldValue?: string;
    newValue?: string;
  },
): Promise<void> {
  const task = await ctx.db.get(args.taskId);
  if (!task) return;
  // Attribute to the bot of the integration this task is linked through (a
  // workspace can hold several). Resolve via the task's link; fall back to the
  // workspace lookup for the rare unlinked case.
  const taskLink = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .unique();
  const projectLink = taskLink
    ? await ctx.db.get(taskLink.projectIntegrationLinkId)
    : null;
  const integration = projectLink
    ? await getIntegrationForLink(ctx, projectLink)
    : await getWorkspaceIntegration(ctx, task.workspaceId);
  if (!integration) return;

  await logActivity(ctx, {
    userId: integration.botUserId,
    resourceType: "tasks",
    resourceId: args.taskId.toString(),
    action: args.type,
    resourceName: task.title,
    oldValue: args.oldValue,
    newValue: args.newValue,
    scope: task.workspaceId,
    source: "integration",
  });
}
