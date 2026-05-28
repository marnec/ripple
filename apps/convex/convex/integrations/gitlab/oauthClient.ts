/**
 * GitLab OAuth 2.0 + REST client for the project-registration flow. Owns every
 * HTTP call that needs the OAuth client credentials or a user access token:
 *  - building the authorize URL (PKCE S256);
 *  - exchanging an auth code for an access+refresh bundle;
 *  - refreshing a bundle when the access token is near expiry;
 *  - reading the current user (for `accountLogin` / `externalBotLogin`);
 *  - listing projects the user has Maintainer access to (for the picker);
 *  - creating a project webhook on link activation.
 *
 * No Convex deps. The mutations/actions that drive the flow pass in the env
 * config (`gitlabOAuthFromEnv`) and persist/read the bundle through internal
 * queries/mutations themselves. Tests inject a `fetchImpl` to assert request
 * shapes without hitting the network.
 *
 * Self-hosted GitLab is intentionally not yet supported: the default
 * `GITLAB_BASE` is gitlab.com. Adding a per-install `instanceUrl` is a one-line
 * change here when we get to it.
 */

export const GITLAB_BASE = "https://gitlab.com";
const API_V4 = "/api/v4";

export interface GitlabOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Override gitlab base (test injection). Defaults to gitlab.com. */
  base?: string;
  /** Override fetch (test injection). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface GitlabTokenBundle {
  accessToken: string;
  refreshToken: string;
  /** Absolute ms-since-epoch when the access token expires. */
  expiresAt: number;
}

export interface GitlabCurrentUser {
  id: number;
  username: string;
}

export interface GitlabProjectSummary {
  id: number;
  pathWithNamespace: string;
  defaultBranch: string | null;
  webUrl: string;
}

const DEFAULT_SCOPE = "api";

/**
 * Generate a high-entropy PKCE code verifier (RFC 7636 §4.1). Base64url of 32
 * random bytes — well within the 43–128 char spec range. SubtleCrypto's
 * `getRandomValues` is available in both Convex's V8 runtime and Node.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Derive the S256 PKCE challenge from a verifier (RFC 7636 §4.2):
 * `BASE64URL(SHA256(verifier))`. The challenge is what we send to GitLab in
 * the authorize URL; the verifier stays on our side until the token exchange.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Build the GitLab authorize URL the browser is redirected to. `state` carries
 * our one-time install nonce so the callback can resolve the originating
 * workspace + actor.
 */
export function buildAuthorizeUrl(args: {
  cfg: GitlabOAuthConfig;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const base = args.cfg.base ?? GITLAB_BASE;
  const params = new URLSearchParams({
    client_id: args.cfg.clientId,
    redirect_uri: args.cfg.redirectUri,
    response_type: "code",
    state: args.state,
    scope: args.scope ?? DEFAULT_SCOPE,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${base}/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access+refresh bundle. The verifier is
 * the raw PKCE secret we kept on our side; GitLab will hash it server-side and
 * compare against the `code_challenge` it remembered from the authorize step.
 */
export async function exchangeCodeForToken(args: {
  cfg: GitlabOAuthConfig;
  code: string;
  codeVerifier: string;
}): Promise<GitlabTokenBundle> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const res = await doFetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.cfg.clientId,
      client_secret: args.cfg.clientSecret,
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: args.cfg.redirectUri,
      code_verifier: args.codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `GitLab token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return parseTokenBundle(await res.json());
}

/**
 * Refresh an access token using the stored refresh token. GitLab rotates the
 * refresh token on each refresh; the caller MUST persist the new bundle (the
 * old refresh token is invalidated on success).
 */
export async function refreshAccessToken(args: {
  cfg: GitlabOAuthConfig;
  refreshToken: string;
}): Promise<GitlabTokenBundle> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const res = await doFetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.cfg.clientId,
      client_secret: args.cfg.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `GitLab token refresh failed: ${res.status} ${await res.text()}`,
    );
  }
  return parseTokenBundle(await res.json());
}

function parseTokenBundle(raw: unknown): GitlabTokenBundle {
  const body = raw as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token || !body.refresh_token) {
    throw new Error("GitLab token response missing access_token/refresh_token");
  }
  // GitLab access tokens default to 2 hours; the spec returns `expires_in` in
  // seconds. Fall back to 2h if the field is absent (safer than treating the
  // token as never-expiring).
  const expiresInSec = typeof body.expires_in === "number" ? body.expires_in : 7200;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

/**
 * Look up the current user the access token authenticates as. Used at install
 * time to set `accountLogin` + `externalBotLogin` (the inbound echo guard uses
 * the latter to suppress bounce-back of our own outbound writes).
 */
export async function fetchCurrentUser(args: {
  cfg: GitlabOAuthConfig;
  accessToken: string;
}): Promise<GitlabCurrentUser> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const res = await doFetch(`${base}${API_V4}/user`, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `GitLab /user lookup failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: number; username: string };
  return { id: body.id, username: body.username };
}

/**
 * List projects the user has at least Maintainer access on (the minimum needed
 * to register a webhook). One page at a time; the picker pages on scroll.
 */
export async function listProjects(args: {
  cfg: GitlabOAuthConfig;
  accessToken: string;
  page?: number;
  perPage?: number;
  search?: string;
}): Promise<GitlabProjectSummary[]> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    membership: "true",
    // 40 = Maintainer; webhook registration requires Maintainer+ on the project.
    min_access_level: "40",
    order_by: "last_activity_at",
    sort: "desc",
    page: String(args.page ?? 1),
    per_page: String(args.perPage ?? 20),
  });
  if (args.search && args.search.trim()) params.set("search", args.search.trim());
  const res = await doFetch(`${base}${API_V4}/projects?${params.toString()}`, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `GitLab listProjects failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as Array<{
    id: number;
    path_with_namespace: string;
    default_branch: string | null;
    web_url: string;
  }>;
  return body.map((p) => ({
    id: p.id,
    pathWithNamespace: p.path_with_namespace,
    defaultBranch: p.default_branch,
    webUrl: p.web_url,
  }));
}

/**
 * List branch names for a project. Used by the project-settings branch picker
 * and the per-link `core/branchesAction` dispatch. Capped at two pages of 100
 * because the picker only needs a reasonable head; pathologically large repos
 * fall back to the free-text affordance.
 */
export async function fetchBranches(args: {
  cfg: GitlabOAuthConfig;
  accessToken: string;
  projectId: number | string;
}): Promise<string[]> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const collected: string[] = [];
  for (let page = 1; page <= 2; page++) {
    // GitLab's /repository/branches endpoint takes a combined `sort` value
    // (`name_asc` | `updated_asc` | `updated_desc`), unlike `/projects` which
    // splits `order_by` + `sort`. Using the split shape returns 400
    // ("sort does not have a valid value"). `updated_desc` puts the freshest
    // branches at the top of the picker, which is what an admin scanning for
    // a branch they just pushed expects.
    const params = new URLSearchParams({
      per_page: "100",
      page: String(page),
      sort: "updated_desc",
    });
    const res = await doFetch(
      `${base}${API_V4}/projects/${encodeURIComponent(String(args.projectId))}/repository/branches?${params.toString()}`,
      { headers: { Authorization: `Bearer ${args.accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(
        `GitLab fetchBranches failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as Array<{ name: string }>;
    for (const b of body) collected.push(b.name);
    if (body.length < 100) break;
  }
  return collected;
}

/**
 * Register a project webhook so GitLab starts delivering issue / comment /
 * merge-request events to our endpoint. The same `token` we register here is
 * what `webhook.ts` verifies via plaintext equality on `X-Gitlab-Token`.
 */
export async function createProjectHook(args: {
  cfg: GitlabOAuthConfig;
  accessToken: string;
  projectId: number;
  url: string;
  token: string;
}): Promise<{ id: number }> {
  const base = args.cfg.base ?? GITLAB_BASE;
  const doFetch = args.cfg.fetchImpl ?? fetch;
  const res = await doFetch(`${base}${API_V4}/projects/${args.projectId}/hooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: args.url,
      token: args.token,
      issues_events: true,
      note_events: true,
      merge_requests_events: true,
      confidential_issues_events: true,
      enable_ssl_verification: true,
      push_events: false,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `GitLab createProjectHook failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: number };
  return { id: body.id };
}

/**
 * Read the OAuth client credentials from the environment. Returns `null` when
 * either is missing — the caller surfaces this as a configuration error
 * (mirrors `githubClientFromEnv` for the App). `GITLAB_OAUTH_REDIRECT_URI`
 * defaults to `${CONVEX_SITE_URL}/integrations/gitlab/oauth/callback` so
 * deployments don't have to set three env vars to get going.
 */
export function gitlabOAuthFromEnv(): GitlabOAuthConfig | null {
  const clientId = process.env.GITLAB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITLAB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const explicit = process.env.GITLAB_OAUTH_REDIRECT_URI;
  const siteUrl = process.env.CONVEX_SITE_URL;
  const redirectUri =
    explicit ??
    (siteUrl ? `${siteUrl}/integrations/gitlab/oauth/callback` : undefined);
  if (!redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/** Base64url-encode (RFC 4648 §5) a byte buffer. No padding, `-`/`_` alphabet. */
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
