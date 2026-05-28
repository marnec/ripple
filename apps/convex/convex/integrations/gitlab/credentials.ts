import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

/**
 * Resolve the stored GitLab token a `credentialRef` points at (seam 2). The
 * outbound actions run in an action context (no `ctx.db`), so they fetch the
 * token through this internal query rather than threading the secret through
 * retrier args. `credentialRef` is the integration's `externalAccountId`.
 *
 * For OAuth installs this returns the current access token; the action-side
 * `tokenClient` calls `getCredentialBundle` separately when it needs the
 * expiry to decide whether to refresh first.
 */
export const getCredentialToken = internalQuery({
  args: { credentialRef: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.credentialRef),
      )
      .unique();
    return integration?.credentialToken ?? null;
  },
});

/**
 * Full credential bundle for the OAuth refresh seam (`tokenClient`). Returns
 * the access token plus the optional OAuth refresh fields; for PAT installs
 * the refresh fields are absent and the seam returns the access token as-is.
 */
export const getCredentialBundle = internalQuery({
  args: { credentialRef: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      accessToken: v.union(v.string(), v.null()),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.credentialRef),
      )
      .unique();
    if (!integration) return null;
    return {
      accessToken: integration.credentialToken ?? null,
      refreshToken: integration.oauthRefreshToken,
      expiresAt: integration.oauthExpiresAt,
    };
  },
});

/**
 * Persist a refreshed OAuth bundle in-place. Called from the token-client
 * after a successful refresh — GitLab rotates both tokens, so we patch all
 * three fields atomically. No-op when the integration row vanished mid-flight
 * (the next outbound op will hit the "missing token" branch and fail loudly).
 */
export const storeRefreshedBundle = internalMutation({
  args: {
    credentialRef: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.credentialRef),
      )
      .unique();
    if (!integration) return null;
    await ctx.db.patch(integration._id, {
      credentialToken: args.accessToken,
      oauthRefreshToken: args.refreshToken,
      oauthExpiresAt: args.expiresAt,
    });
    return null;
  },
});
