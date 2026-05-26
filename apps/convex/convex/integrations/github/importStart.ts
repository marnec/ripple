import { ConvexError, v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { createImportJob } from "../core/importJob";

/**
 * Public entry point the activation wizard calls after binding the repo
 * (`createLink`) and confirming the preview. Admin-gated. Creates the
 * `taskImportJobs` row (pre-allocating the project's task-number range from
 * `expectedTotal`) and schedules the provider drain action, which fetches
 * issues page-by-page and applies them via `core/importJob.applyImportBatch`.
 *
 * `expectedTotal` is the wizard's previewed issue count — it sizes the
 * pre-allocated number range. Issues created on GitHub between preview and
 * activation are handled by the drain defensively; the common case is exact.
 */
export const startGithubImport = mutation({
  args: {
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    includeClosed: v.boolean(),
    labels: v.array(v.string()),
    expectedTotal: v.number(),
  },
  returns: v.object({ jobId: v.id("taskImportJobs") }),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.projectIntegrationLinkId);
    if (!link) throw new ConvexError("Link not found");

    const { userId } = await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", link.workspaceId))
      .filter((q) => q.eq(q.field("provider"), "github"))
      .first();
    if (!integration) {
      throw new ConvexError("No GitHub installation for this workspace");
    }

    const jobId = await createImportJob(ctx, {
      workspaceId: link.workspaceId,
      projectId: link.projectId,
      creatorId: userId,
      projectIntegrationLinkId: args.projectIntegrationLinkId,
      totalRows: args.expectedTotal,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.integrations.github.importDrain.drainImportBatch,
      {
        jobId,
        repoFullName: link.externalRepoFullName,
        externalAccountId: integration.externalAccountId,
        batchStartIndex: 0,
        includeClosed: args.includeClosed,
        labels: args.labels,
      },
    );

    try {
      await auditLog.log(ctx, {
        action: "integration.import_started",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: link.projectId,
        severity: "info",
        metadata: {
          externalRepoFullName: link.externalRepoFullName,
          expectedTotal: args.expectedTotal,
        },
        scope: link.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.import_started", err);
    }

    return { jobId };
  },
});
