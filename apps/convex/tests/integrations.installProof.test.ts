import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

const ENV: Record<string, string> = {
  GITHUB_APP_ID: "3807481",
  // Never reached in these tests — the App JWT is only used for the
  // best-effort account-metadata lookup, which runs after verification.
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
  GITHUB_APP_SLUG: "ripple-app-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  SITE_URL: "https://app.example.com",
};

/**
 * A GitHub App installation id is caller-supplied: it arrives on the setup
 * callback's query string, and installation ids are small sequential integers.
 * Possession of one therefore proves nothing, and the App JWT can mint a real
 * installation token for *any* installation of our App — so claiming someone
 * else's install hands the claimer their private repos.
 *
 * The rule: a GitHub installation may only be claimed when the flow has proven
 * the human completing it can actually see that installation on GitHub
 * (`GET /user/installations` on a user-to-server token). GitLab needs no such
 * flag — its `externalAccountId` comes from `/user` on a token just exchanged,
 * so the proof is structural.
 */
async function adminWithGithubEnabled(t: ReturnType<typeof createTestContext>) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
  await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
    workspaceId,
    featureKey: "github_integration",
    enabled: true,
  });
  return { workspaceId, userId, asUser };
}

describe("GitHub installations require a possession proof", () => {
  it("cannot be claimed through the client-callable mutation", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);

    // A workspace admin — of their OWN workspace, which anyone can create —
    // naming an installation id they do not control.
    await expect(
      asUser.mutation(api.integrations.core.install.completeAppInstallation, {
        workspaceId,
        provider: "github",
        externalAccountId: "victim-installation-42",
        externalAccountType: "organization",
        accountLogin: "victim-org",
      }),
    ).rejects.toThrow(/install callback|possession|verified/i);

    const rows = await t.run((ctx) =>
      ctx.db.query("workspaceIntegrations").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot be claimed through the callback path without the proof either", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await adminWithGithubEnabled(t);

    await expect(
      t.mutation(
        internal.integrations.core.install.completeInstallationFromCallback,
        {
          workspaceId,
          userId,
          provider: "github",
          externalAccountId: "victim-installation-42",
        },
      ),
    ).rejects.toThrow(/install callback|possession|verified/i);
  });

  it("is claimed once the flow has verified the actor can see the installation", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await adminWithGithubEnabled(t);

    const integrationId = await t.mutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId,
        userId,
        provider: "github",
        externalAccountId: "install-owned-by-actor",
        externalAccountType: "organization",
        accountLogin: "acme",
        installationVerified: true,
      },
    );

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row).toMatchObject({
      workspaceId,
      provider: "github",
      externalAccountId: "install-owned-by-actor",
    });
  });

  it("leaves GitLab alone — its account id comes from the token it just exchanged", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await adminWithGithubEnabled(t);
    await asUser.mutation(
      api.integrations.core.entitlements.setWorkspaceFeature,
      { workspaceId, featureKey: "gitlab_integration", enabled: true },
    );

    const integrationId = await t.mutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId,
        userId,
        provider: "gitlab",
        externalAccountId: "9001",
        externalAccountType: "user",
        accountLogin: "octocat",
      },
    );

    expect(await t.run((ctx) => ctx.db.get(integrationId))).toMatchObject({
      provider: "gitlab",
    });
  });
});

/**
 * The setup callback is the only door GitHub installs come through, so it is
 * where the proof has to be produced. GitHub redirects here with `code` when
 * the App has "Request user authorization (OAuth) during installation" turned
 * on; we trade that code for a user-to-server token and ask GitHub which
 * installations that user can actually see.
 */
describe("github/setupAction.finalizeInstall — proving the installation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  /** Start a real install flow and return its one-time state nonce. */
  async function beginInstall(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppInstall,
      { workspaceId },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    return { workspaceId, nonce };
  }

  it("refuses a callback that carries no authorization code", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstall(t);

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { installationId: "victim-installation-42", nonce },
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await t.run((ctx) =>
      ctx.db.query("workspaceIntegrations").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  /** Reply to the token exchange, then to `GET /user/installations`. */
  function mockGithub(opts: { visibleInstallationIds: (string | number)[] }) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
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
              total_count: opts.visibleInstallationIds.length,
              installations: opts.visibleInstallationIds.map((id) => ({ id })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      // Account metadata (App JWT) — best effort, and irrelevant here.
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
  }

  it("refuses an installation the authenticated user cannot see", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstall(t);
    // The attacker really did authenticate with GitHub — they just don't have
    // access to installation 42. This is the whole attack.
    mockGithub({ visibleInstallationIds: [777] });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { installationId: "42", nonce, code: "valid-code-for-attacker" },
    );

    expect(result).toBeNull();
    const rows = await t.run((ctx) =>
      ctx.db.query("workspaceIntegrations").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("completes the install when the user can see the installation", async () => {
    const t = createTestContext();
    const { workspaceId, nonce } = await beginInstall(t);
    mockGithub({ visibleInstallationIds: [42, 777] });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { installationId: "42", nonce, code: "valid-code" },
    );

    expect(result).toEqual({ workspaceId });
    const rows = await t.run((ctx) =>
      ctx.db.query("workspaceIntegrations").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId,
      provider: "github",
      externalAccountId: "42",
    });
  });

  it("sends the code to GitHub with the App's client credentials, and the token to /user/installations", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstall(t);
    mockGithub({ visibleInstallationIds: [42] });

    await t.action(internal.integrations.github.setupAction.finalizeInstall, {
      installationId: "42",
      nonce,
      code: "the-code",
    });

    const calls = fetchMock.mock.calls;
    const exchange = calls.find(([u]) => String(u).includes("access_token"))!;
    expect(exchange).toBeDefined();
    const sentBody = String(exchange[1]?.body ?? "");
    expect(sentBody).toContain("the-code");
    expect(sentBody).toContain(ENV.GITHUB_APP_CLIENT_ID);
    expect(sentBody).toContain(ENV.GITHUB_APP_CLIENT_SECRET);

    const lookup = calls.find(([u]) => String(u).includes("/user/installations"))!;
    expect(lookup).toBeDefined();
    const authHeader = new Headers(lookup[1]?.headers).get("authorization");
    expect(authHeader).toBe("Bearer ghu_usertoken");
  });

  it("the setup route forwards the code and lands the browser on success", async () => {
    const t = createTestContext();
    const { workspaceId, nonce } = await beginInstall(t);
    mockGithub({ visibleInstallationIds: [42] });

    const res = await t.fetch(
      `/integrations/github/setup?installation_id=42&state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces/${workspaceId}/settings?github_install=success`,
    );
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("access_token")),
    ).toBe(true);
  });

  /**
   * The dead end this exists to remove: once the App is installed on an account,
   * `installations/new` redirects to that installation's settings page on GitHub
   * and never returns, so a workspace could not reclaim an installation it could
   * plainly see. Authorizing (no `installation_id`) parks the visible accounts
   * and the user picks one.
   */
  it("authorization without an installation_id parks the accounts for a picker", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppAuthorize,
      { workspaceId, returnTo: "/workspaces/x/settings" },
    );
    expect(url).toContain("login/oauth/authorize");
    expect(url).toContain(ENV.GITHUB_APP_CLIENT_ID);
    const nonce = new URL(url).searchParams.get("state")!;

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes("login/oauth/access_token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "ghu_usertoken" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            total_count: 2,
            installations: [
              { id: 42, account: { login: "marnec", type: "User" } },
              { id: 99, account: { login: "acme", type: "Organization" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { nonce, code: "authorize-code" },
    );

    expect(result?.candidateToken).toBeTruthy();
    expect(result?.returnTo).toBe("/workspaces/x/settings");
    // Nothing is connected yet — the user has not chosen.
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);

    const parked = await asUser.query(
      api.integrations.core.install.listInstallCandidates,
      { token: result!.candidateToken! },
    );
    expect(parked?.candidates).toEqual([
      { externalAccountId: "42", accountLogin: "marnec", accountType: "user" },
      {
        externalAccountId: "99",
        accountLogin: "acme",
        accountType: "organization",
      },
    ]);

    const integrationId = await asUser.mutation(
      api.integrations.core.install.claimInstallation,
      { token: result!.candidateToken!, externalAccountId: "99" },
    );
    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row).toMatchObject({
      workspaceId,
      provider: "github",
      externalAccountId: "99",
      accountLogin: "acme",
      externalBotLogin: "ripple-app-dev[bot]",
    });
  });

  it("refuses to claim an account that was not in the authorized list", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppAuthorize,
      { workspaceId, returnTo: "/workspaces/x/settings" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGithub({ visibleInstallationIds: [42] });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { nonce, code: "authorize-code" },
    );

    // The picker's list is the possession proof; anything off-list is refused.
    await expect(
      asUser.mutation(api.integrations.core.install.claimInstallation, {
        token: result!.candidateToken!,
        externalAccountId: "victim-installation-777",
      }),
    ).rejects.toThrow(/not part of this authorization/i);
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
  });

  it("burns the candidate token so a claim cannot be replayed", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppAuthorize,
      { workspaceId, returnTo: "/workspaces/x/settings" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGithub({ visibleInstallationIds: [42] });
    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { nonce, code: "authorize-code" },
    );
    const token = result!.candidateToken!;

    await asUser.mutation(api.integrations.core.install.claimInstallation, {
      token,
      externalAccountId: "42",
    });

    await expect(
      asUser.mutation(api.integrations.core.install.claimInstallation, {
        token,
        externalAccountId: "42",
      }),
    ).rejects.toThrow(/expired/i);
  });

  it("does not show one admin the accounts another admin authorized", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await adminWithGithubEnabled(t);
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppAuthorize,
      { workspaceId, returnTo: "/workspaces/x/settings" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGithub({ visibleInstallationIds: [42] });
    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { nonce, code: "authorize-code" },
    );

    const { asUser: asOther } = await setupAuthenticatedUser(t, {
      name: "Other admin",
      email: "other@test.com",
    });
    // The list came off someone else's GitHub account — not theirs to browse.
    expect(
      await asOther.query(api.integrations.core.install.listInstallCandidates, {
        token: result!.candidateToken!,
      }),
    ).toBeNull();
  });

  it("the setup route sends the browser to the error page when ownership is not proven", async () => {
    const t = createTestContext();
    const { nonce } = await beginInstall(t);
    mockGithub({ visibleInstallationIds: [777] });

    const res = await t.fetch(
      `/integrations/github/setup?installation_id=42&state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces?github_install=error`,
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("workspaceIntegrations").collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
