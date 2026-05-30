import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getIntegrationForLink } from "./integrationLookups";
import { logTaskIntegrationActivity } from "./integrationActivity";

/**
 * Provider-agnostic branch list for the project-settings pickers (branch
 * automation map, default base branch). Resolves the link's provider once and
 * delegates to the per-provider action, which owns the auth + transport. The
 * existing GitHub action stays public for backwards compatibility; new
 * frontends should call this entry instead so the picker works for any
 * provider without UI branches.
 *
 * Returns `[]` for unknown providers — same degrade-to-free-text contract the
 * per-provider actions follow on credential / network failure.
 */
export const listRepoBranches = action({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.array(v.string()),
  handler: async (ctx, { linkId }) => {
    const provider = await ctx.runQuery(
      internal.integrations.core.branchesAction.providerForLink,
      { linkId },
    );
    if (provider === "github") {
      return ctx.runAction(
        api.integrations.github.branchesAction.listRepoBranches,
        { linkId },
      );
    }
    if (provider === "gitlab") {
      return ctx.runAction(
        api.integrations.gitlab.branchesAction.listRepoBranches,
        { linkId },
      );
    }
    return [];
  },
});

export const providerForLink = internalQuery({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    const integration = await getIntegrationForLink(ctx, link);
    return integration?.provider ?? null;
  },
});

/**
 * Resolve the provider for a TASK's integration link (a task carries exactly
 * one link — `taskIntegrationLinks` is unique `by_task`). Mirrors
 * `providerForLink` but keyed on the task, so the task-detail branch dispatch
 * below can pick the provider without the FE knowing it.
 */
export const providerForTask = internalQuery({
  args: { taskId: v.id("tasks") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { taskId }) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique();
    if (!link) return null;
    const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
    if (!projectLink) return null;
    const integration = await getIntegrationForLink(ctx, projectLink);
    return integration?.provider ?? null;
  },
});

/**
 * Provider-agnostic "branch sources for a task's Create-branch picker". Resolves
 * the task's provider once and delegates to the per-provider action (which owns
 * auth + transport and is task-membership gated via its own context query).
 * Degrades to empty/null on any failure, matching the per-provider contract.
 */
export const listTaskRepoBranches = action({
  args: { taskId: v.id("tasks") },
  returns: v.object({
    branches: v.array(v.string()),
    defaultBranch: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { taskId }) => {
    const provider = await ctx.runQuery(
      internal.integrations.core.branchesAction.providerForTask,
      { taskId },
    );
    if (provider === "github") {
      return ctx.runAction(
        api.integrations.github.branchesAction.listTaskRepoBranches,
        { taskId },
      );
    }
    if (provider === "gitlab") {
      return ctx.runAction(
        api.integrations.gitlab.branchesAction.listTaskRepoBranches,
        { taskId },
      );
    }
    return { branches: [], defaultBranch: null };
  },
});

/**
 * Provider-agnostic "create a branch for this task's linked issue". Dispatches
 * to the per-provider action, which names the branch `<issueNumber>-<slug>`,
 * resolves the base (explicit arg → project default → repo default), and records
 * `branchName` + `branchBaseRef` on the task link via `recordTaskBranchName`.
 * User-initiated, so it runs synchronously and surfaces `ConvexError`s.
 */
export const createBranchForTask = action({
  args: {
    taskId: v.id("tasks"),
    baseBranch: v.optional(v.string()),
  },
  returns: v.object({
    branchName: v.string(),
    baseBranch: v.string(),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, { taskId, baseBranch }) => {
    const provider = await ctx.runQuery(
      internal.integrations.core.branchesAction.providerForTask,
      { taskId },
    );
    if (provider === "github") {
      return ctx.runAction(
        api.integrations.github.branchesAction.createBranchForTask,
        { taskId, baseBranch },
      );
    }
    if (provider === "gitlab") {
      return ctx.runAction(
        api.integrations.gitlab.branchesAction.createBranchForTask,
        { taskId, baseBranch },
      );
    }
    throw new ConvexError("This task isn't linked to an issue");
  },
});

/**
 * Persist a created branch name + base on the task's link (drives the UI chip
 * and the prefilled compare/MR URL's base). Provider-neutral — only patches
 * `taskIntegrationLinks` and logs activity — so both the GitHub and GitLab
 * branch actions record through this single writer.
 */
export const recordTaskBranchName = internalMutation({
  args: {
    linkId: v.id("taskIntegrationLinks"),
    taskId: v.id("tasks"),
    branchName: v.string(),
    baseBranch: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { linkId, taskId, branchName, baseBranch }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    await ctx.db.patch(linkId, { branchName, branchBaseRef: baseBranch });
    await logTaskIntegrationActivity(ctx, {
      taskId,
      type: "branch_created",
      newValue: branchName,
    });
    return null;
  },
});
