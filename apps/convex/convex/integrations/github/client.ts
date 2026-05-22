import { signAppJwt } from "./app";

/**
 * Wrapper around GitHub's REST/GraphQL API. Owns everything an authenticated
 * GitHub call needs so callers don't re-assemble it:
 *  1. App-JWT signing + installation-token minting.
 *  2. Authenticated REST/GraphQL calls returning the normalized response shape
 *     `core/syncOut.classifyResponse` consumes.
 *  3. App-level installation metadata lookup.
 *
 * Two entry points:
 *  - `githubClientFromEnv()` reads the App credentials from the environment
 *    once (returning `null` when unconfigured), replacing the env-preamble that
 *    every action used to copy.
 *  - `client.forInstallation(id)` returns an {@link InstallationClient} that
 *    mints the installation token lazily (once, cached) and exposes token-free
 *    methods, so callers stop threading `installationToken` through every call.
 *
 * Retry/backoff is NOT this layer's job — the action-retrier component owns
 * that. Each method makes exactly one HTTP request.
 */

export interface GithubClientConfig {
  appId: string;
  privateKeyPem: string;
  /** Override base URL (test injection). Defaults to https://api.github.com. */
  apiBase?: string;
  /** Override fetch (test injection). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface GithubResponse<T = unknown> {
  status: number;
  body?: T;
  retryAfterMs?: number;
  errorMessage?: string;
}

export class GithubClient {
  private readonly apiBase: string;
  private readonly doFetch: typeof fetch;

  constructor(private cfg: GithubClientConfig) {
    this.apiBase = cfg.apiBase ?? "https://api.github.com";
    this.doFetch = cfg.fetchImpl ?? fetch;
  }

  /**
   * Bind an installation id, returning a handle that mints the token lazily
   * (once, cached) and exposes token-free REST/GraphQL methods. The preferred
   * way to make installation-scoped calls.
   */
  forInstallation(externalAccountId: string): InstallationClient {
    return new InstallationClient(this, externalAccountId);
  }

  /**
   * App-JWT-authenticated lookup of an installation's account (login + type).
   * Used by the install callback to capture display metadata; best-effort, so
   * a non-2xx returns `null` rather than throwing.
   */
  async fetchInstallationAccount(externalAccountId: string): Promise<{
    login?: string;
    type: "organization" | "user";
  } | null> {
    const jwt = await signAppJwt({
      appId: this.cfg.appId,
      privateKeyPem: this.cfg.privateKeyPem,
    });
    const res = await this.doFetch(
      `${this.apiBase}/app/installations/${encodeURIComponent(externalAccountId)}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      account?: { login?: string; type?: string };
    };
    return {
      login: body.account?.login,
      type: body.account?.type === "Organization" ? "organization" : "user",
    };
  }

  /**
   * Mint a short-lived installation token. GitHub returns
   *  { token, expires_at } — the token authenticates subsequent REST calls
   *  for that installation. Tokens expire ~1h; callers should cache.
   */
  async mintInstallationToken(externalAccountId: string): Promise<string> {
    const jwt = await signAppJwt({
      appId: this.cfg.appId,
      privateKeyPem: this.cfg.privateKeyPem,
    });
    const res = await this.doFetch(
      `${this.apiBase}/app/installations/${encodeURIComponent(externalAccountId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `GitHub mintInstallationToken failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { token: string };
    return body.token;
  }

  /**
   * Resolve the stable issue node ids a PR closes via GitHub's GraphQL API.
   * The REST `pull_request` webhook payload does not carry linked issues, so
   * the PR→issue link (whether from "Closes #N" in the body or GitHub's
   * Development sidebar) is only authoritatively available through
   * `closingIssuesReferences`. Returns the node ids, which match the
   * `externalIssueId` stored on `taskIntegrationLinks`.
   */
  async fetchClosingIssueNodeIds(args: {
    installationToken: string;
    owner: string;
    repo: string;
    prNumber: number;
  }): Promise<string[]> {
    const query = `query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          closingIssuesReferences(first:50){ nodes { id } }
        }
      }
    }`;
    const res = await this.doFetch(`${this.apiBase}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.installationToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          owner: args.owner,
          repo: args.repo,
          number: args.prNumber,
        },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        repository?: {
          pullRequest?: {
            closingIssuesReferences?: { nodes?: { id: string }[] };
          } | null;
        } | null;
      };
    };
    const nodes =
      json.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
    return nodes.map((n) => n.id);
  }

  /**
   * List a repo's branch names (first page, up to 100) for the branch→status
   * settings dropdown. Pagination beyond 100 is intentionally not handled —
   * the UI also accepts free-text, so a long-tail branch can still be mapped.
   */
  async fetchBranches(args: {
    installationToken: string;
    owner: string;
    repo: string;
  }): Promise<string[]> {
    const res = await this.doFetch(
      `${this.apiBase}/repos/${args.owner}/${args.repo}/branches?per_page=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.installationToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const body = (await res.json()) as { name: string }[];
    return Array.isArray(body) ? body.map((b) => b.name) : [];
  }

  /**
   * Issue an authenticated REST call using a pre-minted installation
   * token. Returns the normalized response shape consumed by
   * `core/syncOut.classifyResponse`.
   */
  async request<T = unknown>(args: {
    installationToken: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<GithubResponse<T>> {
    try {
      const res = await this.doFetch(`${this.apiBase}${args.path}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${args.installationToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(args.body ? { "Content-Type": "application/json" } : {}),
        },
        body: args.body ? JSON.stringify(args.body) : undefined,
      });

      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      let parsed: T | undefined;
      try {
        if (res.headers.get("content-type")?.includes("application/json")) {
          parsed = (await res.json()) as T;
        }
      } catch {
        // body not JSON or empty — leave parsed undefined
      }

      return {
        status: res.status,
        body: parsed,
        retryAfterMs,
      };
    } catch (err) {
      // Network error / DNS failure / abort — `null` status signals retry.
      return {
        status: null as unknown as number,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * The token-explicit surface an {@link InstallationClient} drives. `GithubClient`
 * satisfies it structurally; tests inject a fake to exercise the binding/caching
 * without minting a real JWT.
 */
export interface AuthedGithubApi {
  mintInstallationToken(externalAccountId: string): Promise<string>;
  request<T = unknown>(args: {
    installationToken: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<GithubResponse<T>>;
  fetchBranches(args: {
    installationToken: string;
    owner: string;
    repo: string;
  }): Promise<string[]>;
  fetchClosingIssueNodeIds(args: {
    installationToken: string;
    owner: string;
    repo: string;
    prNumber: number;
  }): Promise<string[]>;
}

/**
 * Installation-scoped handle. Mints the installation token on first use and
 * caches it for the handle's lifetime, then threads it into the underlying
 * client so callers express only the call, not the auth.
 */
export class InstallationClient {
  private tokenPromise: Promise<string> | null = null;

  constructor(
    private readonly api: AuthedGithubApi,
    private readonly externalAccountId: string,
  ) {}

  private token(): Promise<string> {
    return (this.tokenPromise ??= this.api.mintInstallationToken(
      this.externalAccountId,
    ));
  }

  async request<T = unknown>(args: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<GithubResponse<T>> {
    return this.api.request<T>({ installationToken: await this.token(), ...args });
  }

  async fetchBranches(args: { owner: string; repo: string }): Promise<string[]> {
    return this.api.fetchBranches({ installationToken: await this.token(), ...args });
  }

  async fetchClosingIssueNodeIds(args: {
    owner: string;
    repo: string;
    prNumber: number;
  }): Promise<string[]> {
    return this.api.fetchClosingIssueNodeIds({
      installationToken: await this.token(),
      ...args,
    });
  }
}

/**
 * Construct a `GithubClient` from the App credentials in the environment.
 * Returns `null` when unconfigured — the single home for the
 * `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` check that every action repeated.
 */
export function githubClientFromEnv(): GithubClient | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) return null;
  return new GithubClient({ appId, privateKeyPem });
}

function parseRetryAfterMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const asInt = parseInt(raw, 10);
  if (!Number.isNaN(asInt)) return asInt * 1000;
  // HTTP-date format — fall back to undefined; outbound retrier will use
  // its default backoff.
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return undefined;
  return Math.max(0, ts - Date.now());
}
