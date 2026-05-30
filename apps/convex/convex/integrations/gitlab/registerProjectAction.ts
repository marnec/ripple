import { ConvexError, v } from "convex/values";
import { action, query } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  createProjectHook,
  gitlabOAuthFromEnv,
  listProjects,
} from "./oauthClient";
import { getValidGitlabAccessToken } from "./tokenClient";

/**
 * Public picker for the OAuth flow's "pick a GitLab project to connect" step.
 * Admin-gated; uses the workspace's OAuth token (refreshing if near expiry)
 * to list projects the user has Maintainer+ on. Returns one page at a time;
 * the picker UI re-queries with `page + 1` as the user scrolls.
 *
 * `externalAccountId` is the integration row's key (the OAuth user id). We
 * pass it explicitly rather than discovering it: a workspace can have many
 * installs (org/personal), and the picker is bound to ONE of them.
 */
export const listMyProjects = action({
  args: {
    workspaceId: v.id("workspaces"),
    externalAccountId: v.string(),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      id: v.number(),
      pathWithNamespace: v.string(),
      defaultBranch: v.union(v.string(), v.null()),
      webUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await ctx.runQuery(
      internal.integrations.gitlab.oauthAction.assertAdminForOAuth,
      { workspaceId: args.workspaceId },
    );
    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      throw new ConvexError("GitLab OAuth is not configured");
    }
    const accessToken = await getValidGitlabAccessToken(
      ctx,
      args.externalAccountId,
    );
    if (!accessToken) {
      throw new ConvexError(
        "GitLab authorization expired or was revoked. Please reconnect this GitLab integration.",
      );
    }
    return await listProjects({
      cfg,
      accessToken,
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.perPage !== undefined ? { perPage: args.perPage } : {}),
      ...(args.search !== undefined ? { search: args.search } : {}),
    });
  },
});

/**
 * One-shot "link this GitLab project to this Ripple project" — the picker's
 * commit step. Bundles the two operations the user used to do by hand:
 *
 *  1. Create the `projectIntegrationLinks` row (existing `createLink` mutation
 *     mints a per-link webhook secret and rehydrates frozen tasks).
 *  2. POST `/projects/:id/hooks` on GitLab with our URL + that secret +
 *     issue / note / MR events enabled — so events start flowing immediately
 *     without the admin pasting anything into GitLab's UI.
 *
 * On hook-registration failure we unlink (mark disconnected) the just-created
 * link so the UI doesn't show a half-configured state. The unlink cascade is
 * a no-op when nothing references the link yet.
 *
 * `webhookUrl` derives from `CONVEX_SITE_URL` (same as
 * `getLinkWebhookConfig`); we recompute it here rather than read the link row
 * back so the action stays single-round-trip.
 */
export const registerProject = action({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    externalAccountId: v.string(),
    gitlabProjectId: v.number(),
    pathWithNamespace: v.string(),
  },
  returns: v.id("projectIntegrationLinks"),
  handler: async (ctx, args) => {
    await ctx.runQuery(
      internal.integrations.gitlab.oauthAction.assertAdminForOAuth,
      { workspaceId: args.workspaceId },
    );
    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      throw new ConvexError("GitLab OAuth is not configured");
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new ConvexError("CONVEX_SITE_URL is not configured");
    }
    const accessToken = await getValidGitlabAccessToken(
      ctx,
      args.externalAccountId,
    );
    if (!accessToken) {
      throw new ConvexError(
        "GitLab authorization expired or was revoked. Please reconnect this GitLab integration.",
      );
    }

    // Create the link first so `createLink` mints the webhook secret. We then
    // re-read it through the admin-gated config query to get back the secret
    // (createLink only returns the id).
    const linkId = await ctx.runMutation(api.integrations.core.links.createLink, {
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      externalAccountId: args.externalAccountId,
      externalRepoId: String(args.gitlabProjectId),
      externalRepoFullName: args.pathWithNamespace,
    });

    const cfgRow = await ctx.runQuery(
      api.integrations.core.links.getLinkWebhookConfig,
      { linkId },
    );
    if (!cfgRow.webhookSecret) {
      // Defensive: createLink always mints one for gitlab, but if something
      // changes upstream we don't want to register a webhook without a token.
      await ctx.runMutation(api.integrations.core.links.unlinkLink, { linkId });
      throw new ConvexError("Link created without a webhook secret");
    }

    try {
      await createProjectHook({
        cfg,
        accessToken,
        projectId: args.gitlabProjectId,
        url: cfgRow.webhookUrl,
        token: cfgRow.webhookSecret,
      });
    } catch (err) {
      // GitLab rejected the hook (insufficient scope, project deleted between
      // pick + commit, etc.) — roll back so the link doesn't dangle in a
      // half-configured state the user has to clean up manually.
      try {
        await ctx.runMutation(api.integrations.core.links.unlinkLink, { linkId });
      } catch (cleanupErr) {
        console.error(
          "[gitlab/registerProject] rollback unlink failed",
          cleanupErr,
        );
      }
      throw new ConvexError(
        `Could not register the webhook on GitLab: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return linkId;
  },
});

/**
 * Lightweight client-readable check: is GitLab OAuth configured on this
 * deployment? Drives the "Connect with GitLab" button vs the "Paste a PAT"
 * fallback in the connect card. A query so the connect card can subscribe
 * without a round-trip on every render.
 */
export const isOAuthConfigured = query({
  args: {},
  returns: v.boolean(),
  handler: async () => gitlabOAuthFromEnv() !== null,
});

