import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import { internal } from "../convex/_generated/api";

/**
 * Refresh-on-demand seam tests. Exercises the three branches in
 * `getValidGitlabAccessToken`:
 *   1. PAT install (no refresh fields) → returns stored token as-is, no fetch.
 *   2. OAuth install, token still valid → returns cached, no fetch.
 *   3. OAuth install, token within skew window → refreshes via fake fetch and
 *      persists the rotated bundle.
 *
 * Mocks `global.fetch` so the test fails loudly if a branch that shouldn't
 * touch the network does (case 1 + 2). PAT path also asserts that
 * `gitlabOAuthFromEnv` not being configured doesn't matter — the early return
 * never reaches the refresh branch.
 */
async function insertIntegration(
  t: ReturnType<typeof createTestContext>,
  args: {
    workspaceId: ReturnType<typeof setupWorkspaceWithAdmin> extends Promise<{
      workspaceId: infer W;
    }>
      ? W
      : never;
    externalAccountId: string;
    credentialToken?: string;
    oauthRefreshToken?: string;
    oauthExpiresAt?: number;
  },
) {
  return t.run(async (ctx) => {
    const botUserId = await ctx.db.insert("users", {
      name: "gitlab",
      isBot: true,
    });
    return ctx.db.insert("workspaceIntegrations", {
      workspaceId: args.workspaceId,
      botUserId,
      provider: "gitlab",
      externalAccountId: args.externalAccountId,
      credentialToken: args.credentialToken,
      oauthRefreshToken: args.oauthRefreshToken,
      oauthExpiresAt: args.oauthExpiresAt,
    });
  });
}

describe("integrations/gitlab/tokenClient.getValidGitlabAccessToken", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITLAB_OAUTH_CLIENT_ID;
    delete process.env.GITLAB_OAUTH_CLIENT_SECRET;
    delete process.env.GITLAB_OAUTH_REDIRECT_URI;
  });

  it("PAT install: returns stored token without hitting the network", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await insertIntegration(t, {
      workspaceId,
      externalAccountId: "acct-pat",
      credentialToken: "glpat-xxx",
    });

    const token = await t.action(
      internal.integrations.gitlab.tokenClientTestHelper.runResolve,
      { credentialRef: "acct-pat" },
    );
    expect(token).toBe("glpat-xxx");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OAuth install with fresh token: returns cached token without refresh", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await insertIntegration(t, {
      workspaceId,
      externalAccountId: "acct-oauth",
      credentialToken: "at-fresh",
      oauthRefreshToken: "rt-1",
      // 1 hour ahead — comfortably outside the 60s skew window.
      oauthExpiresAt: Date.now() + 60 * 60 * 1000,
    });

    process.env.GITLAB_OAUTH_CLIENT_ID = "cid";
    process.env.GITLAB_OAUTH_CLIENT_SECRET = "csec";
    process.env.GITLAB_OAUTH_REDIRECT_URI = "https://app.example/cb";

    const token = await t.action(
      internal.integrations.gitlab.tokenClientTestHelper.runResolve,
      { credentialRef: "acct-oauth" },
    );
    expect(token).toBe("at-fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OAuth install near expiry: refreshes, persists rotated bundle, returns new token", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const integrationId = await insertIntegration(t, {
      workspaceId,
      externalAccountId: "acct-stale",
      credentialToken: "at-stale",
      oauthRefreshToken: "rt-1",
      // 30s ahead — inside the 60s skew window so we refresh.
      oauthExpiresAt: Date.now() + 30 * 1000,
    });

    process.env.GITLAB_OAUTH_CLIENT_ID = "cid";
    process.env.GITLAB_OAUTH_CLIENT_SECRET = "csec";
    process.env.GITLAB_OAUTH_REDIRECT_URI = "https://app.example/cb";

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "at-new",
          refresh_token: "rt-2",
          expires_in: 7200,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const token = await t.action(
      internal.integrations.gitlab.tokenClientTestHelper.runResolve,
      { credentialRef: "acct-stale" },
    );
    expect(token).toBe("at-new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");

    // Persisted: subsequent read sees the rotated bundle.
    const persisted = await t.run((ctx) => ctx.db.get(integrationId));
    expect(persisted?.credentialToken).toBe("at-new");
    expect(persisted?.oauthRefreshToken).toBe("rt-2");
    expect(persisted?.oauthExpiresAt).toBeGreaterThan(Date.now() + 60 * 1000);
  });

  it("OAuth install but env unconfigured: returns null (can't refresh)", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await insertIntegration(t, {
      workspaceId,
      externalAccountId: "acct-orphan",
      credentialToken: "at-stale",
      oauthRefreshToken: "rt-1",
      oauthExpiresAt: Date.now() + 1000,
    });

    // env vars intentionally absent — refresh branch can't proceed.
    const token = await t.action(
      internal.integrations.gitlab.tokenClientTestHelper.runResolve,
      { credentialRef: "acct-orphan" },
    );
    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown credentialRef: returns null", async () => {
    const t = createTestContext();
    const token = await t.action(
      internal.integrations.gitlab.tokenClientTestHelper.runResolve,
      { credentialRef: "does-not-exist" },
    );
    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
