import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "../../functions";
import { requireUser, requireWorkspaceMember } from "../../authHelpers";

/**
 * "Connect your GitHub / GitLab account" — the self-service, account-level
 * identity flow.
 *
 * The assignee matcher (`identity.ts`, layer 2) reads `users.githubLogin` /
 * `users.gitlabUserId`, which until now were written only by the sign-in
 * profile map in `auth.ts`. A member who signed up by email therefore never
 * had one, and every assignee push for them was silently skipped. This module
 * is the second writer: an explicit OAuth round trip from user settings that
 * proves which provider account the member is, then stores just the login/id.
 *
 * Provider-neutral half. Reuses the install-state nonce (`installFlow.ts`)
 * with `purpose: "identity"` so the provider callbacks, which are single-entry
 * per provider, can tell the two round trips apart and dispatch accordingly.
 */

/** Same lifetime as the install nonce (`installFlow.INSTALL_STATE_TTL_MS`). */
const IDENTITY_STATE_TTL_MS = 15 * 60 * 1000;

export const providerValidator = v.union(
  v.literal("github"),
  v.literal("gitlab"),
);

/**
 * Start an identity connect. **Member**-gated, not admin: the member is
 * proving their own identity, and the nonce needs a workspace only so the
 * callback has somewhere to send them back to.
 *
 * GitHub's authorize URL is the same one `beginAppAuthorize` uses — the App's
 * user-authorization flow — and the callback tells the two apart by the
 * nonce's `purpose`. GitLab needs PKCE and so cannot start from a mutation;
 * its entry point is the action in `gitlab/identityAction.ts`.
 */
export const beginIdentityConnect = mutation({
  args: {
    provider: providerValidator,
    workspaceId: v.id("workspaces"),
    /** App-relative path to land on afterwards, e.g. `/workspaces/<id>/tasks`. */
    returnTo: v.string(),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);

    if (args.provider !== "github") {
      throw new ConvexError(
        "GitLab identity connect starts from integrations.gitlab.identityAction.beginIdentityConnect",
      );
    }

    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    if (!clientId) {
      throw new ConvexError(
        "GITHUB_APP_CLIENT_ID is not configured on the Convex deployment",
      );
    }

    // Reject anything that could send the user off-site after the round trip.
    if (!args.returnTo.startsWith("/") || args.returnTo.startsWith("//")) {
      throw new ConvexError("returnTo must be an app-relative path");
    }

    const nonce = crypto.randomUUID();
    await ctx.db.insert("integrationInstallStates", {
      nonce,
      workspaceId: args.workspaceId,
      userId,
      provider: "github",
      purpose: "identity",
      expiresAt: Date.now() + IDENTITY_STATE_TTL_MS,
      returnTo: args.returnTo,
    });

    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(nonce)}`;
    return { url };
  },
});

/**
 * Finish an identity connect: write the provider identity the finalizer just
 * confirmed with one `GET /user` onto the caller's user row. Internal — only
 * the provider finalizers call it, after the nonce and token exchange proved
 * the account belongs to this user.
 *
 * Canonical form is `trim().toLowerCase()`, matching what `auth.ts` captures
 * at sign-in and what the matcher compares against. GitHub is addressed by
 * login, so only `githubLogin` is kept; GitLab assigns by numeric id and
 * mentions by username, so it keeps both.
 */
export const completeIdentityConnect = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    externalLogin: v.string(),
    externalUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const login = args.externalLogin.trim().toLowerCase();
    if (login.length === 0) {
      throw new ConvexError("Provider returned an empty login");
    }

    // Refuse, never overwrite. The matcher resolves a login/id to a member only
    // when exactly one user carries it (`.take(2)` + `length !== 1`), so a
    // silent second writer would not steal the identity — it would unmap BOTH
    // users. The holder keeps it; the claimant is told why.
    const holders =
      args.provider === "github"
        ? await ctx.db
            .query("users")
            .withIndex("by_github_login", (q) => q.eq("githubLogin", login))
            .take(2)
        : await ctx.db
            .query("users")
            .withIndex("by_gitlab_user_id", (q) =>
              q.eq("gitlabUserId", args.externalUserId),
            )
            .take(2);
    if (holders.some((u) => u._id !== args.userId)) {
      throw new ConvexError(
        `That ${args.provider === "github" ? "GitHub" : "GitLab"} account is already connected to another Ripple user`,
      );
    }

    if (args.provider === "github") {
      await ctx.db.patch(args.userId, { githubLogin: login });
    } else {
      await ctx.db.patch(args.userId, {
        gitlabUserId: args.externalUserId,
        gitlabLogin: login,
      });
    }
    return null;
  },
});

/**
 * Drop the caller's own connected identity for one provider. Only the
 * caller's row, only that provider's columns.
 *
 * Note: this is not a permanent opt-out. A later sign-in *through* that
 * provider re-captures the identity via the `auth.ts` profile map — the same
 * writer that filled the column for users who signed up with the provider.
 */
export const disconnectIdentity = mutation({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (args.provider === "github") {
      await ctx.db.patch(userId, { githubLogin: undefined });
    } else {
      await ctx.db.patch(userId, {
        gitlabUserId: undefined,
        gitlabLogin: undefined,
      });
    }
    return null;
  },
});
