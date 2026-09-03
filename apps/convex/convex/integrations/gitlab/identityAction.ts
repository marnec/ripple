import { ConvexError, v } from "convex/values";
import { action, internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireWorkspaceMember } from "../../authHelpers";
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  exchangeCodeForToken,
  fetchCurrentUser,
  generateCodeVerifier,
  gitlabOAuthFromEnv,
} from "./oauthClient";

/**
 * GitLab half of "connect your account" (`core/identityConnect.ts` is the
 * provider-neutral half). GitLab's authorize round trip needs PKCE, which
 * needs `crypto.subtle.digest`, so unlike GitHub the entry point is an action
 * rather than a mutation. Mirrors `oauthAction.beginOAuth` with three
 * differences: any **member** may start it, the nonce carries
 * `purpose: "identity"` + `returnTo`, and the scope is `read_user` — enough
 * for one `GET /user`, nothing that could touch a project.
 */

/** Same lifetime as the install nonce (`installFlow.INSTALL_STATE_TTL_MS`). */
const IDENTITY_STATE_TTL_MS = 15 * 60 * 1000;

/** The only scope an identity connect needs: who is this token's user. */
export const IDENTITY_SCOPE = "read_user";

export const beginIdentityConnect = action({
  args: {
    workspaceId: v.id("workspaces"),
    /** App-relative path to land on afterwards, e.g. `/workspaces/<id>/tasks`. */
    returnTo: v.string(),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(
      internal.integrations.gitlab.identityAction.requireMemberForOAuth,
      { workspaceId: args.workspaceId },
    );

    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      throw new ConvexError(
        "GitLab OAuth is not configured (GITLAB_OAUTH_CLIENT_ID/SECRET).",
      );
    }

    // Reject anything that could send the user off-site after the round trip.
    if (!args.returnTo.startsWith("/") || args.returnTo.startsWith("//")) {
      throw new ConvexError("returnTo must be an app-relative path");
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
        expiresAt: Date.now() + IDENTITY_STATE_TTL_MS,
        codeVerifier: verifier,
        purpose: "identity",
        returnTo: args.returnTo,
      },
    );

    const url = buildAuthorizeUrl({
      cfg,
      state: nonce,
      codeChallenge: challenge,
      scope: IDENTITY_SCOPE,
    });
    return { url };
  },
});

/**
 * Member gate for `beginIdentityConnect` — the member counterpart of
 * `oauthAction.assertAdminForOAuth`. A member proving their own identity
 * needs no authority over the workspace; the nonce needs one only so the
 * callback knows where to send them back.
 */
export const requireMemberForOAuth = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);
    return { userId };
  },
});

/**
 * Finish a "connect your GitLab account" round trip from the shared
 * `/integrations/gitlab/oauth/callback`. Consumes the identity-purpose nonce,
 * exchanges the code with the stored PKCE verifier, asks GitLab who that is
 * with one `GET /user`, and writes id + username onto the member's user row
 * through `completeIdentityConnect`. The token is never stored.
 *
 * Returns where to send the browser on success, or null on any failure —
 * including a nonce minted for an *install*: an install nonce proves the
 * actor is an admin who started binding an account to a workspace, not which
 * GitLab account the actor personally is. Every failure is `console.error` +
 * null rather than a throw, because the route is a browser navigation and a
 * throw is a raw 500 instead of the documented `?gitlab_identity=error`.
 */
export const finalizeIdentity = internalAction({
  args: { nonce: v.string(), code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      returnTo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const resolved = await ctx.runMutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: args.nonce },
    );
    if (!resolved || !resolved.codeVerifier) return null;
    if (resolved.purpose !== "identity") {
      console.error(
        "[gitlab/identity] refusing: nonce was minted for an install, not an identity connect",
      );
      return null;
    }

    const cfg = gitlabOAuthFromEnv();
    if (!cfg) {
      console.error("[gitlab/identity] callback fired but env client missing");
      return null;
    }

    let user: Awaited<ReturnType<typeof fetchCurrentUser>>;
    try {
      const bundle = await exchangeCodeForToken({
        cfg,
        code: args.code,
        codeVerifier: resolved.codeVerifier,
      });
      user = await fetchCurrentUser({ cfg, accessToken: bundle.accessToken });
    } catch (err) {
      console.error("[gitlab/identity] could not resolve the GitLab user", err);
      return null;
    }

    // `completeIdentityConnect` throws when another user already holds the
    // id; like every other failure here that becomes the error redirect.
    try {
      await ctx.runMutation(
        internal.integrations.core.identityConnect.completeIdentityConnect,
        {
          userId: resolved.userId,
          provider: "gitlab",
          externalLogin: user.username,
          externalUserId: String(user.id),
        },
      );
    } catch (err) {
      console.error("[gitlab/identity] could not store the GitLab identity", err);
      return null;
    }

    return { workspaceId: resolved.workspaceId, returnTo: resolved.returnTo };
  },
});
