/**
 * GitHub *user-to-server* OAuth calls for the App install flow. Deliberately
 * separate from `client.ts`, which owns App-JWT and installation-token calls:
 * those authenticate *Ripple*, these authenticate *the human who just
 * installed*, and conflating the two is what let an installation be claimed by
 * someone who had never seen it.
 *
 * Only two operations are needed, both during `finalizeInstall`:
 *  1. trade the callback's `?code` for a short-lived user access token;
 *  2. ask which installations that user can actually see.
 *
 * The token is used once and never stored — nothing about this flow is
 * per-user configuration.
 *
 * Requires the App's client id/secret, which sit on the same GitHub App
 * settings page as `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`, plus the
 * "Request user authorization (OAuth) during installation" option enabled so
 * GitHub actually sends `?code` to the setup URL.
 *
 * No Convex deps; tests inject `fetchImpl` to assert request shapes.
 */

const GITHUB_WEB_BASE = "https://github.com";
const GITHUB_API_BASE = "https://api.github.com";

export interface GithubAppOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Override github.com (test injection). */
  webBase?: string;
  /** Override api.github.com (test injection). */
  apiBase?: string;
  /** Override fetch (test injection). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Read the App's OAuth client credentials from the environment. Returns `null`
 * when unconfigured, which the caller must treat as "cannot verify" and so
 * "cannot complete the install" — never as "skip the check".
 */
export function githubAppOAuthFromEnv(): GithubAppOAuthConfig | null {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Exchange the setup callback's `code` for a user access token.
 *
 * GitHub returns 200 with `{ error: "bad_verification_code" }` in the body for
 * a bad code rather than a 4xx, so the body is checked, not just the status.
 */
export async function exchangeUserCode(args: {
  cfg: GithubAppOAuthConfig;
  code: string;
}): Promise<string> {
  const { cfg, code } = args;
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(
    `${cfg.webBase ?? GITHUB_WEB_BASE}/login/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
      }).toString(),
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub code exchange failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!body.access_token) {
    throw new Error(
      `GitHub code exchange returned no token: ${body.error ?? "unknown"}`,
    );
  }
  return body.access_token;
}

export interface GithubUserInstallation {
  /** String because that is how `workspaceIntegrations.externalAccountId`
   *  stores it; GitHub sends a number. */
  externalAccountId: string;
  accountLogin?: string;
  accountType?: "organization" | "user";
}

/**
 * List every App installation the holder of this user token can see
 * (`GET /user/installations`), with enough account metadata to render a picker.
 *
 * Paginated at 100/page. A user with more than a few installations is already
 * unusual, but the loop is cheap and a truncated list would silently reject a
 * legitimate install.
 */
export async function listUserInstallations(args: {
  cfg: GithubAppOAuthConfig;
  accessToken: string;
}): Promise<GithubUserInstallation[]> {
  const { cfg, accessToken } = args;
  const doFetch = cfg.fetchImpl ?? fetch;
  const apiBase = cfg.apiBase ?? GITHUB_API_BASE;

  const out: GithubUserInstallation[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await doFetch(
      `${apiBase}/user/installations?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub /user/installations failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      installations?: {
        id?: number | string;
        account?: { login?: string; type?: string };
      }[];
    };
    const batch = body.installations ?? [];
    for (const install of batch) {
      if (install.id === undefined) continue;
      out.push({
        externalAccountId: String(install.id),
        accountLogin: install.account?.login,
        accountType:
          install.account?.type === undefined
            ? undefined
            : install.account.type === "Organization"
              ? "organization"
              : "user",
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Ids only — the shape the install-time ownership check needs.
 */
export async function listUserInstallationIds(args: {
  cfg: GithubAppOAuthConfig;
  accessToken: string;
}): Promise<string[]> {
  const installs = await listUserInstallations(args);
  return installs.map((i) => i.externalAccountId);
}
