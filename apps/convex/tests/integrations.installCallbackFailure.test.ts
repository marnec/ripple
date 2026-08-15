import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * The two provider callbacks — `/integrations/github/setup` and
 * `/integrations/gitlab/oauth/callback` — are browser navigations, not API
 * calls. Their documented contract is "always redirects, never returns raw
 * JSON": the user comes back from github.com/gitlab.com and must land inside
 * Ripple whatever happened.
 *
 * `doCompleteInstall` throws `ConvexError` on three ordinary, non-exceptional
 * conditions — the workspace lacks the `<provider>_integration` entitlement
 * (the default state of every workspace), the external account is already
 * claimed by another workspace, or the actor is no longer an admin by the time
 * the callback fires. Left uncaught, each of those reaches the browser as a
 * bare 500: no redirect, no message, and — on the GitHub path — an App now
 * installed on the user's org with no `workspaceIntegrations` row to show for
 * it, and on the GitLab path a live `api`-scope token silently discarded.
 *
 * These tests drive the real HTTP routes and the two finalize actions and
 * assert the failure stays inside the redirect contract.
 */
const GITHUB_ENV: Record<string, string> = {
  GITHUB_APP_ID: "3807481",
  GITHUB_APP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
  GITHUB_APP_SLUG: "ripple-app-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  SITE_URL: "https://app.example.com",
};

describe("github setup callback — failures stay inside the redirect contract", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const [k, val] of Object.entries(GITHUB_ENV)) process.env[k] = val;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(GITHUB_ENV)) delete process.env[k];
  });

  /** Reply to the token exchange, then to `GET /user/installations`. */
  function mockGithub(visibleInstallationIds: (string | number)[]) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login/oauth/access_token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "ghu_usertoken" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/user/installations")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              total_count: visibleInstallationIds.length,
              installations: visibleInstallationIds.map((id) => ({ id })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      // Best-effort account metadata (App JWT) — irrelevant here.
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
  }

  /**
   * Begin a real install flow WITHOUT enabling the entitlement, by writing the
   * state row directly. The admin-gated `beginAppInstall` mutation refuses this
   * once the flow is entitlement-gated; what is under test here is the callback
   * that fires 30 seconds later, when the entitlement may have gone away for
   * any reason.
   */
  async function beginInstallWithoutEntitlement(
    t: ReturnType<typeof createTestContext>,
  ) {
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const nonce = crypto.randomUUID();
    await t.run((ctx) =>
      ctx.db.insert("integrationInstallStates", {
        nonce,
        workspaceId,
        userId,
        provider: "github",
        expiresAt: Date.now() + 15 * 60 * 1000,
      }),
    );
    return { workspaceId, nonce };
  }

  it("sends the browser to the error page when the workspace has no entitlement", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstallWithoutEntitlement(t);
    // Ownership IS proven — the user really installed the App on account 42.
    // The install still cannot complete, and that is the user's whole journey.
    mockGithub([42]);

    const res = await t.fetch(
      `/integrations/github/setup?installation_id=42&state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${GITHUB_ENV.SITE_URL}/workspaces?github_install=error`,
    );
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
  });

  /**
   * `siteUrl` is `process.env.SITE_URL ?? ""`, and `Response.redirect` rejects
   * a relative URL with a `TypeError`. On a deployment that forgot the var,
   * every exit from this route — success AND the error redirect — throws out of
   * the handler. A misconfigured deployment cannot be made to redirect
   * anywhere useful, but it can refuse in a way that names the cause.
   */
  it("refuses with a diagnosable response when SITE_URL is not configured", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstallWithoutEntitlement(t);
    mockGithub([42]);
    delete process.env.SITE_URL;

    const res = await t.fetch(
      `/integrations/github/setup?installation_id=42&state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/SITE_URL/);
  });
});

const GITLAB_ENV: Record<string, string> = {
  GITLAB_OAUTH_CLIENT_ID: "cid",
  GITLAB_OAUTH_CLIENT_SECRET: "csec",
  GITLAB_OAUTH_REDIRECT_URI:
    "https://app.example.com/integrations/gitlab/oauth/callback",
  CONVEX_SITE_URL: "https://app.example.com",
  SITE_URL: "https://app.example.com",
};

describe("gitlab oauth callback — failures stay inside the redirect contract", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const [k, val] of Object.entries(GITLAB_ENV)) process.env[k] = val;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(GITLAB_ENV)) delete process.env[k];
  });

  /** Reply to the PKCE token exchange, then to `GET /api/v4/user`. */
  function mockGitlab() {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "glpat-access",
              refresh_token: "glpat-refresh",
              expires_in: 7200,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v4/user")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 9001, username: "octocat" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
  }

  /**
   * State row written directly, for the same reason as the GitHub helper
   * above: `beginOAuth` refuses an unentitled workspace, but the callback
   * fires minutes later and must survive the entitlement being off then.
   */
  async function beginOAuthWithoutEntitlement(
    t: ReturnType<typeof createTestContext>,
  ) {
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const nonce = crypto.randomUUID();
    await t.run((ctx) =>
      ctx.db.insert("integrationInstallStates", {
        nonce,
        workspaceId,
        userId,
        provider: "gitlab",
        expiresAt: Date.now() + 15 * 60 * 1000,
        codeVerifier: "verifier-kept-server-side",
      }),
    );
    return { workspaceId, nonce };
  }

  it("sends the browser to the error page when the workspace has no entitlement", async () => {
    const t = createTestContext();
    const { nonce } = await beginOAuthWithoutEntitlement(t);
    mockGitlab();

    const res = await t.fetch(
      `/integrations/gitlab/oauth/callback?code=the-code&state=${nonce}`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${GITLAB_ENV.SITE_URL}/workspaces?gitlab_oauth=error`,
    );
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
  });

  it("refuses with a diagnosable response when SITE_URL is not configured", async () => {
    const t = createTestContext();
    const { nonce } = await beginOAuthWithoutEntitlement(t);
    mockGitlab();
    delete process.env.SITE_URL;

    const res = await t.fetch(
      `/integrations/gitlab/oauth/callback?code=the-code&state=${nonce}`,
      { method: "GET" },
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/SITE_URL/);
  });
});
