import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  exchangeCodeForToken,
  fetchCurrentUser,
  generateCodeVerifier,
  gitlabOAuthFromEnv,
} from "./oauthClient";

/** Lifetime of the state nonce — generous enough for the user to read GitLab's
 *  consent screen, mirrors `INSTALL_STATE_TTL_MS` in `installFlow.ts`. */
const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Start the GitLab OAuth flow. Admin-gated. Generates the PKCE verifier (which
 * stays server-side until the callback), derives the S256 challenge for the
 * authorize URL, persists `{nonce, codeVerifier, workspaceId, userId}` for the
 * callback to consume, and returns the authorize URL the browser navigates to.
 *
 * Why an action (vs the GitHub App's `beginAppInstall` mutation): PKCE needs
 * `crypto.subtle.digest` and we want all OAuth-flavored code in one module.
 */
export const beginOAuth = action({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    // Admin gate runs through a query so `action` doesn't have to re-implement
    // the workspace-role check — the only public surface here.
    const { userId } = await ctx.runQuery(
      internal.integrations.gitlab.oauthAction.assertAdminForOAuth,
      { workspaceId: args.workspaceId },
    );

    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      throw new ConvexError(
        "GitLab OAuth is not configured (GITLAB_OAUTH_CLIENT_ID/SECRET).",
      );
    }

    const verifier = generateCodeVerifier();
    const challenge = await deriveCodeChallenge(verifier);
    const nonce = crypto.randomUUID();

    await ctx.runMutation(
      internal.integrations.core.installFlow.persistInstallState,
      {
        nonce,
        workspaceId: args.workspaceId,
        userId,
        provider: "gitlab",
        expiresAt: Date.now() + STATE_TTL_MS,
        codeVerifier: verifier,
      },
    );

    const url = buildAuthorizeUrl({ cfg, state: nonce, codeChallenge: challenge });
    return { url };
  },
});

/**
 * Admin role check for `beginOAuth`. Exposed as an internal query so the
 * `action` above can stay declarative; mirrors the pattern in
 * `assertWizardInstallation`.
 */
export const assertAdminForOAuth = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    return { userId };
  },
});

/**
 * Finalize the GitLab OAuth callback. The HTTP route hands us the auth code
 * and our state nonce; we consume the nonce (one-time) → exchange the code
 * for an access+refresh bundle → look up the current user (for `accountLogin`
 * and the inbound echo guard's `externalBotLogin`) → upsert the
 * `workspaceIntegrations` row carrying all three credential fields.
 *
 * Returns the workspaceId on success so the HTTP route can redirect into that
 * workspace's settings; null on any failure (bad nonce, exchange failure,
 * unconfigured env) so the route can redirect with an error flag.
 *
 * Note: idempotent on `(workspaceId, externalAccountId)` via
 * `completeInstallationFromCallback`. Re-running the OAuth flow refreshes the
 * stored bundle without duplicating the bot user.
 */
export const finalizeOAuth = internalAction({
  args: { code: v.string(), nonce: v.string() },
  returns: v.union(v.null(), v.object({ workspaceId: v.id("workspaces") })),
  handler: async (ctx, args) => {
    const resolved = await ctx.runMutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: args.nonce },
    );
    if (!resolved || !resolved.codeVerifier) return null;

    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      console.error("[gitlab/oauth] callback fired but env client missing");
      return null;
    }

    let bundle;
    try {
      bundle = await exchangeCodeForToken({
        cfg,
        code: args.code,
        codeVerifier: resolved.codeVerifier,
      });
    } catch (err) {
      console.error("[gitlab/oauth] token exchange failed", err);
      return null;
    }

    let user;
    try {
      user = await fetchCurrentUser({ cfg, accessToken: bundle.accessToken });
    } catch (err) {
      console.error("[gitlab/oauth] /user lookup failed", err);
      return null;
    }

    // The "account" key on GitLab is the OAuth user — there's no install-level
    // entity equivalent to a GitHub App install. So `externalAccountId` is the
    // numeric user id (stable across renames), `accountLogin` is the username.
    // `externalBotLogin` is the same username: events authored by this user
    // are our own outbound echo (the inbound echo guard suppresses them).
    await ctx.runMutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId: resolved.workspaceId,
        userId: resolved.userId,
        provider: "gitlab",
        externalAccountId: String(user.id),
        externalAccountType: "user",
        accountLogin: user.username,
        externalBotLogin: user.username,
        credentialToken: bundle.accessToken,
        oauthRefreshToken: bundle.refreshToken,
        oauthExpiresAt: bundle.expiresAt,
      },
    );

    return { workspaceId: resolved.workspaceId };
  },
});
