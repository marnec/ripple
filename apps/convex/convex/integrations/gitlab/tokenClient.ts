import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  gitlabOAuthFromEnv,
  refreshAccessToken,
} from "./oauthClient";

/**
 * Refresh-on-demand access-token resolver. Mirror of GitHub's
 * `InstallationClient`: the gateway calls this once per outbound op and gets
 * back a token guaranteed valid for the call. The seam folds together three
 * cases so the gateway stays oblivious to credential shape:
 *
 *  1. PAT install (`refreshToken`/`expiresAt` absent) → return the stored token
 *     as-is. PATs don't expire on a fixed clock.
 *  2. OAuth install, token still valid (expiry > 60s away) → return the cached
 *     access token without touching GitLab.
 *  3. OAuth install, token near expiry → POST to `/oauth/token` for a fresh
 *     bundle, persist it (GitLab rotates the refresh token too), return the
 *     new access token.
 *
 * Returns `null` when no credentials are stored at all, or when the integration
 * is OAuth-flavored but the env client is not configured (we can't refresh
 * without the OAuth client id/secret). Callers translate `null` into the
 * existing "credentials not configured" permanent-failure path.
 *
 * Refresh skew: 60s. GitLab access tokens default to 2h, so this is generous
 * enough to absorb clock drift + a single retry without re-entering the
 * refresh branch in the same outbound op.
 */
const EXPIRY_SKEW_MS = 60_000;

export async function getValidGitlabAccessToken(
  ctx: ActionCtx,
  credentialRef: string,
): Promise<string | null> {
  const bundle = await ctx.runQuery(
    internal.integrations.gitlab.credentials.getCredentialBundle,
    { credentialRef },
  );
  if (!bundle || !bundle.accessToken) return null;
  // PAT path: no refresh material, return as-is.
  if (!bundle.refreshToken || !bundle.expiresAt) return bundle.accessToken;
  // OAuth path, token still fresh.
  if (bundle.expiresAt - Date.now() > EXPIRY_SKEW_MS) return bundle.accessToken;
  // OAuth path, refresh needed.
  const cfg = gitlabOAuthFromEnv();
  if (!cfg) {
    // We have an OAuth bundle but the env client is gone — can't refresh.
    // Surfacing the stale token would just produce a 401 downstream, so fail
    // loudly here instead.
    console.error(
      "[gitlab/tokenClient] OAuth refresh required but GITLAB_OAUTH_CLIENT_ID/SECRET missing",
    );
    return null;
  }
  const refreshed = await refreshAccessToken({
    cfg,
    refreshToken: bundle.refreshToken,
  });
  await ctx.runMutation(
    internal.integrations.gitlab.credentials.storeRefreshedBundle,
    {
      credentialRef,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    },
  );
  return refreshed.accessToken;
}
