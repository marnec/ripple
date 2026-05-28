import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/** State-nonce lifetime. The user has this long to complete the GitHub
 *  install redirect before the nonce is rejected as stale. */
const INSTALL_STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Start the GitHub App install flow. Admin-gated. Persists a one-time state
 * nonce tying the eventual install-callback to this workspace + initiating
 * user, and returns the GitHub install URL the client should redirect to.
 *
 * `GITHUB_APP_SLUG` is the App's public slug (the `github.com/apps/<slug>`
 * segment). The callback at `/integrations/github/setup` consumes the nonce
 * to resolve the workspace.
 */
export const beginAppInstall = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) {
      throw new ConvexError(
        "GITHUB_APP_SLUG is not configured on the Convex deployment",
      );
    }

    const nonce = crypto.randomUUID();
    await ctx.db.insert("integrationInstallStates", {
      nonce,
      workspaceId: args.workspaceId,
      userId,
      provider: "github",
      expiresAt: Date.now() + INSTALL_STATE_TTL_MS,
    });

    const url = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(nonce)}`;
    return { url };
  },
});

/**
 * Resolve + delete an install-state nonce. Internal — called by the
 * `/integrations/github/setup` HTTP callback. One-time use: the row is
 * deleted on consume so a replayed callback can't re-resolve it. Returns
 * null for unknown or expired nonces (the callback treats either as a
 * failed install and redirects with an error).
 *
 * `codeVerifier` is the PKCE secret stored at OAuth-begin time (GitLab),
 * absent for the GitHub App flow.
 */
export const consumeInstallState = internalMutation({
  args: { nonce: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      userId: v.id("users"),
      provider: v.string(),
      codeVerifier: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrationInstallStates")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;

    // One-time use regardless of validity.
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return null;

    return {
      workspaceId: row.workspaceId,
      userId: row.userId,
      provider: row.provider,
      codeVerifier: row.codeVerifier,
    };
  },
});

/**
 * Persist a one-time install-state nonce with an optional PKCE verifier. The
 * GitLab OAuth flow calls this from an action context (the verifier must be
 * generated client-side-of-action so its hash can go into the authorize URL),
 * which is why this is a separate mutation rather than being inlined in the
 * GitHub App's `beginAppInstall`.
 */
export const persistInstallState = internalMutation({
  args: {
    nonce: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    expiresAt: v.number(),
    codeVerifier: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("integrationInstallStates", {
      nonce: args.nonce,
      workspaceId: args.workspaceId,
      userId: args.userId,
      provider: args.provider,
      expiresAt: args.expiresAt,
      codeVerifier: args.codeVerifier,
    });
    return null;
  },
});
