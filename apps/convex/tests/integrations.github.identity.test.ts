import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * GitHub half of "connect your account" (plan A): the setup callback consumes
 * an identity-purpose nonce, trades the code for a user token, asks GitHub
 * who the user is, discards the token and stores the login. The install path
 * and the identity path share one callback route and one nonce table, so
 * they must be unable to complete each other.
 */
const ENV: Record<string, string> = {
  GITHUB_APP_SLUG: "ripple-app-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  SITE_URL: "https://app.example.com",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const [k, val] of Object.entries(ENV)) process.env[k] = val;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

/** Reply to the token exchange, then to `GET /user`. */
function mockGithubUser(user: { id: number; login: string }) {
  const seen: string[] = [];
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("login/oauth/access_token")) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "ghu_usertoken" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.endsWith("/user")) {
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth !== "Bearer ghu_usertoken") {
        return Promise.resolve(new Response("{}", { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  return seen;
}

async function memberWhoBeganConnect(t: ReturnType<typeof createTestContext>) {
  const { workspaceId } = await setupWorkspaceWithAdmin(t);
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Member",
    email: "member@test.com",
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  const { url } = await asUser.mutation(
    api.integrations.core.identityConnect.beginIdentityConnect,
    { provider: "github", workspaceId, returnTo: "/workspaces/x/tasks" },
  );
  const nonce = new URL(url).searchParams.get("state")!;
  return { workspaceId, userId, nonce };
}

describe("github/setupAction.finalizeIdentity", () => {
  it("stores the login GitHub reports for the code's user and returns where to go", async () => {
    const t = createTestContext();
    const { workspaceId, userId, nonce } = await memberWhoBeganConnect(t);
    const seen = mockGithubUser({ id: 583231, login: "OctoCat" });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toEqual({ workspaceId, returnTo: "/workspaces/x/tasks" });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.githubLogin).toBe(
      "octocat",
    );
    // One `GET /user`, no installation listing — this is not an install.
    expect(seen.some((u) => u.includes("/user/installations"))).toBe(false);
    expect(seen.filter((u) => u.endsWith("/user"))).toHaveLength(1);
  });
});

describe("github — install and identity nonces cannot complete each other", () => {
  it("finalizeIdentity refuses an install nonce and stores nothing", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });
    const { url } = await asUser.mutation(
      api.integrations.core.installFlow.beginAppAuthorize,
      { workspaceId, returnTo: "/workspaces/x/settings" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGithubUser({ id: 1, login: "admin-gh" });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(userId)))?.githubLogin).toBeUndefined();
    // The nonce is still one-time: the install path cannot use it either now.
    expect(
      await t.mutation(internal.integrations.core.installFlow.consumeInstallState, { nonce }),
    ).toBeNull();
  });

  it("finalizeInstall refuses an identity nonce and binds nothing", async () => {
    const t = createTestContext();
    // The strongest case: the nonce belongs to an entitled ADMIN, so nothing
    // but the purpose stands between the callback and a completed install.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });
    const { url } = await asUser.mutation(
      api.integrations.core.identityConnect.beginIdentityConnect,
      { provider: "github", workspaceId, returnTo: "/workspaces/x" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    process.env.GITHUB_APP_ID = "3807481";
    process.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----";
    // Even a GitHub that says "yes, this user can see installation 42".
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
          new Response(JSON.stringify({ total_count: 1, installations: [{ id: 42 }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeInstall,
      { installationId: "42", nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("integrationInstallCandidates").collect()),
    ).toHaveLength(0);
  });

  it("a replayed identity callback fails", async () => {
    const t = createTestContext();
    const { nonce } = await memberWhoBeganConnect(t);
    mockGithubUser({ id: 583231, login: "octocat" });

    const first = await t.action(
      internal.integrations.github.setupAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );
    const second = await t.action(
      internal.integrations.github.setupAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("a login another user holds fails the round trip and leaves both rows untouched", async () => {
    const t = createTestContext();
    const { userId, nonce } = await memberWhoBeganConnect(t);
    const holderId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Holder", githubLogin: "octocat" }),
    );
    mockGithubUser({ id: 583231, login: "OctoCat" });

    const result = await t.action(
      internal.integrations.github.setupAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(userId)))?.githubLogin).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(holderId)))?.githubLogin).toBe("octocat");
  });
});

describe("GET /integrations/github/setup — dispatches on the nonce's purpose", () => {
  it("sends a completed identity connect back where it started with its own flag", async () => {
    const t = createTestContext();
    const { userId, nonce } = await memberWhoBeganConnect(t);
    mockGithubUser({ id: 583231, login: "octocat" });

    const res = await t.fetch(
      `/integrations/github/setup?state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces/x/tasks?github_identity=success`,
    );
    expect((await t.run((ctx) => ctx.db.get(userId)))?.githubLogin).toBe("octocat");
  });

  it("sends a failed identity connect to the workspace list with the identity error flag, not the install one", async () => {
    const t = createTestContext();
    const { nonce } = await memberWhoBeganConnect(t);
    // GitHub rejects the code.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await t.fetch(
      `/integrations/github/setup?state=${nonce}&code=bad`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces?github_identity=error`,
    );
  });
});
