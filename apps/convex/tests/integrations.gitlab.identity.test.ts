import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { maybeEnqueueAssigneesPush } from "../convex/integrations/core/outboundDispatch";
import { externalUserIdToMember } from "../convex/integrations/core/identity";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";

/**
 * GitLab half of "connect your account" (plan A, ticket 02): the OAuth
 * callback consumes an identity-purpose nonce, exchanges the code with PKCE,
 * asks GitLab who the user is, discards the token and stores BOTH the numeric
 * user id (assignment) and the lowercase username (mentions). The install
 * path and the identity path share one callback route and one nonce table,
 * so they must be unable to complete each other.
 */
const ENV: Record<string, string> = {
  GITLAB_OAUTH_CLIENT_ID: "cid",
  GITLAB_OAUTH_CLIENT_SECRET: "csec",
  GITLAB_OAUTH_REDIRECT_URI: "https://api.example/integrations/gitlab/oauth/callback",
  CONVEX_SITE_URL: "https://api.example",
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
});

/** A non-admin member of a fresh workspace. */
async function memberOf(t: ReturnType<typeof createTestContext>) {
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
  return { workspaceId, userId, asUser };
}

describe("gitlab/identityAction.beginIdentityConnect", () => {
  it("lets a plain member start the flow, asks only for read_user, and persists an identity-purpose nonce", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await memberOf(t);

    const { url } = await asUser.action(
      api.integrations.gitlab.identityAction.beginIdentityConnect,
      { workspaceId, returnTo: "/workspaces/x/tasks" },
    );

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://gitlab.com/oauth/authorize");
    expect(parsed.searchParams.get("scope")).toBe("read_user");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    const nonce = parsed.searchParams.get("state")!;

    const row = await t.run((ctx) =>
      ctx.db
        .query("integrationInstallStates")
        .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
        .unique(),
    );
    expect(row).toMatchObject({
      workspaceId,
      userId,
      provider: "gitlab",
      purpose: "identity",
      returnTo: "/workspaces/x/tasks",
    });
    expect(typeof row?.codeVerifier).toBe("string");
  });
});

/** Reply to the PKCE token exchange, then to `GET /api/v4/user`. */
function mockGitlabUser(user: { id: number; username: string }) {
  const seen: { url: string; body?: string }[] = [];
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/oauth/token")) {
      const form = new URLSearchParams(String(init?.body));
      if (!form.get("code_verifier")) {
        return Promise.resolve(new Response("{}", { status: 400 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "glat", refresh_token: "glrt", expires_in: 7200 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.endsWith("/api/v4/user")) {
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth !== "Bearer glat") {
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
  const { workspaceId, userId, asUser } = await memberOf(t);
  const { url } = await asUser.action(
    api.integrations.gitlab.identityAction.beginIdentityConnect,
    { workspaceId, returnTo: "/workspaces/x/tasks" },
  );
  const nonce = new URL(url).searchParams.get("state")!;
  return { workspaceId, userId, asUser, nonce };
}

describe("gitlab/identityAction.finalizeIdentity", () => {
  it("stores the id and lowercase username GitLab reports and returns where to go", async () => {
    const t = createTestContext();
    const { workspaceId, userId, nonce } = await memberWhoBeganConnect(t);
    const seen = mockGitlabUser({ id: 9, username: "Alice" });

    const result = await t.action(
      internal.integrations.gitlab.identityAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toEqual({ workspaceId, returnTo: "/workspaces/x/tasks" });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.gitlabUserId).toBe("9");
    expect(user?.gitlabLogin).toBe("alice");
    // One `GET /user`; nothing else touched, nothing installed.
    expect(seen.filter((s) => s.url.endsWith("/api/v4/user"))).toHaveLength(1);
    expect(seen.some((s) => s.url.includes("/projects"))).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
  });
});

describe("gitlab — install and identity nonces cannot complete each other", () => {
  it("finalizeIdentity refuses an install nonce and stores nothing", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { url } = await asUser.action(
      api.integrations.gitlab.oauthAction.beginOAuth,
      { workspaceId },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGitlabUser({ id: 1, username: "admin-gl" });

    const result = await t.action(
      internal.integrations.gitlab.identityAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.gitlabUserId).toBeUndefined();
    expect(user?.gitlabLogin).toBeUndefined();
    // One-time: the install path cannot use it either now.
    expect(
      await t.mutation(internal.integrations.core.installFlow.consumeInstallState, { nonce }),
    ).toBeNull();
  });

  it("finalizeOAuth refuses an identity nonce and installs nothing", async () => {
    const t = createTestContext();
    // The strongest case: an entitled ADMIN minted the identity nonce, so
    // nothing but the purpose stands between the callback and an install
    // driven by a read_user-scoped token.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "gitlab_integration",
      enabled: true,
    });
    const { url } = await asUser.action(
      api.integrations.gitlab.identityAction.beginIdentityConnect,
      { workspaceId, returnTo: "/workspaces/x" },
    );
    const nonce = new URL(url).searchParams.get("state")!;
    mockGitlabUser({ id: 1, username: "admin-gl" });

    const result = await t.action(
      internal.integrations.gitlab.oauthAction.finalizeOAuth,
      { nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("workspaceIntegrations").collect()),
    ).toHaveLength(0);
  });

  it("a replayed identity callback fails", async () => {
    const t = createTestContext();
    const { nonce } = await memberWhoBeganConnect(t);
    mockGitlabUser({ id: 9, username: "alice" });

    const first = await t.action(
      internal.integrations.gitlab.identityAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );
    const second = await t.action(
      internal.integrations.gitlab.identityAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("an id another user holds fails the round trip and leaves both rows untouched", async () => {
    const t = createTestContext();
    const { userId, nonce } = await memberWhoBeganConnect(t);
    const holderId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Holder", gitlabUserId: "9", gitlabLogin: "alice" }),
    );
    mockGitlabUser({ id: 9, username: "Alice" });

    const result = await t.action(
      internal.integrations.gitlab.identityAction.finalizeIdentity,
      { nonce, code: "the-code" },
    );

    expect(result).toBeNull();
    const claimant = await t.run((ctx) => ctx.db.get(userId));
    expect(claimant?.gitlabUserId).toBeUndefined();
    expect(claimant?.gitlabLogin).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(holderId)))?.gitlabUserId).toBe("9");
  });
});

describe("identityConnect.disconnectIdentity (gitlab)", () => {
  it("clears both GitLab columns and leaves GitHub alone", async () => {
    const t = createTestContext();
    const { userId, asUser } = await memberOf(t);
    await t.run((ctx) =>
      ctx.db.patch(userId, { githubLogin: "octocat", gitlabUserId: "9", gitlabLogin: "alice" }),
    );

    await asUser.mutation(api.integrations.core.identityConnect.disconnectIdentity, {
      provider: "gitlab",
    });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.gitlabUserId).toBeUndefined();
    expect(user?.gitlabLogin).toBeUndefined();
    expect(user?.githubLogin).toBe("octocat");
  });
});

describe("GET /integrations/gitlab/oauth/callback — dispatches on the nonce's purpose", () => {
  it("sends a completed identity connect back where it started with its own flag", async () => {
    const t = createTestContext();
    const { userId, nonce } = await memberWhoBeganConnect(t);
    mockGitlabUser({ id: 9, username: "alice" });

    const res = await t.fetch(
      `/integrations/gitlab/oauth/callback?state=${nonce}&code=the-code`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces/x/tasks?gitlab_identity=success`,
    );
    expect((await t.run((ctx) => ctx.db.get(userId)))?.gitlabUserId).toBe("9");
  });

  it("a callback that lost its code still fails with the identity flag, not the install one", async () => {
    const t = createTestContext();
    const { nonce } = await memberWhoBeganConnect(t);

    const res = await t.fetch(`/integrations/gitlab/oauth/callback?state=${nonce}`, {
      method: "GET",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces?gitlab_identity=error`,
    );
  });

  it("sends a failed identity connect to the workspace list with the identity error flag, not the install one", async () => {
    const t = createTestContext();
    const { nonce } = await memberWhoBeganConnect(t);
    // GitLab rejects the code.
    fetchMock.mockResolvedValue(new Response("invalid_grant", { status: 400 }));

    const res = await t.fetch(
      `/integrations/gitlab/oauth/callback?state=${nonce}&code=bad`,
      { method: "GET" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${ENV.SITE_URL}/workspaces?gitlab_identity=error`,
    );
  });
});

describe("gitlab identity connect — what it unlocks", () => {
  /** A GitLab-linked task assigned to `assigneeId`, with GitLab knowing no assignees. */
  async function gitlabLinkedTaskAssignedTo(
    t: ReturnType<typeof createTestContext>,
    workspaceId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["workspaceId"],
    assigneeId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["userId"],
  ) {
    const projectId = await setupProject(t, { workspaceId, creatorId: assigneeId });
    return t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", { name: "GitLab", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "gitlab", externalAccountId: "gl-acct",
        credentialToken: "glpat-x",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        projectId, workspaceId, status: "active", pausedByBilling: false,
        externalRepoId: "42", externalRepoFullName: "acme/web",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Assignee tracer", statusId, priority: "medium",
        completed: false, creatorId: botUserId, assigneeId,
        externalRefs: [{ provider: "gitlab", repoFullName: "acme/web", issueNumber: 7, url: "https://gitlab.com/acme/web/-/issues/7" }],
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId, externalIssueId: "301",
        externalUpdatedAt: 1_000, externalState: "open", externalAssigneeLogins: [],
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://gitlab.com/octocat" },
      });
      const link = (await ctx.db.get(projectLinkId))!;
      return { taskId, link };
    });
  }

  it("after connecting, the assignee push carries the member's GitLab id and an inbound assignee id resolves to them", async () => {
    const t = createTestContext();
    const { workspaceId, userId, nonce } = await memberWhoBeganConnect(t);
    const { taskId, link } = await gitlabLinkedTaskAssignedTo(t, workspaceId, userId);
    const runs = () => t.run((ctx) => ctx.db.query("integrationOutboundRuns").collect());

    // Unconnected: nothing to push, and the inbound id maps to nobody.
    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    expect(await runs()).toHaveLength(0);
    // (`t.run` serializes its result, so an `undefined` comes back as null.)
    expect(
      await t.run((ctx) => externalUserIdToMember(ctx, workspaceId, "gitlab", "9")),
    ).toBeFalsy();

    mockGitlabUser({ id: 9, username: "alice" });
    await t.action(internal.integrations.gitlab.identityAction.finalizeIdentity, {
      nonce,
      code: "the-code",
    });

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    expect(await runs()).toHaveLength(1);
    expect(
      await t.run((ctx) => externalUserIdToMember(ctx, workspaceId, "gitlab", "9")),
    ).toBe(userId);

    // And the inbound reconciler puts them in the slot from the id alone.
    await t.run((ctx) => ctx.db.patch(taskId, { assigneeId: undefined }));
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        link,
        event: {
          kind: "issue.assignees_changed",
          externalIssueId: "301",
          issueNumber: 7,
          externalUpdatedAt: 2_000,
          assignees: [{ login: "alice", avatarUrl: "u", url: "https://gitlab.com/alice", id: "9" }],
        },
      }),
    );
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.assigneeId).toBe(userId);
  });
});
