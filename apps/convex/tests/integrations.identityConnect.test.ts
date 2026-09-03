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

/**
 * "Connect your GitHub / GitLab account" — the self-service, account-level
 * identity flow (plan A). It reuses the install-state nonce with a `purpose`
 * so the provider callbacks can tell an identity round trip from an install.
 */

beforeEach(() => {
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclientid";
});
afterEach(() => {
  delete process.env.GITHUB_APP_CLIENT_ID;
});

/** A non-admin member of the admin's workspace. */
async function memberOf(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["workspaceId"],
  email = "member@test.com",
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Member",
    email,
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return { userId, asUser };
}

describe("identityConnect.beginIdentityConnect (github)", () => {
  it("lets a plain member start the flow and persists an identity-purpose nonce", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId, asUser } = await memberOf(t, workspaceId);

    const { url } = await asUser.mutation(
      api.integrations.core.identityConnect.beginIdentityConnect,
      { provider: "github", workspaceId, returnTo: "/workspaces/x/tasks" },
    );

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(parsed.searchParams.get("client_id")).toBe("Iv1.testclientid");
    const nonce = parsed.searchParams.get("state")!;
    expect(nonce).toBeTruthy();

    const row = await t.run((ctx) =>
      ctx.db
        .query("integrationInstallStates")
        .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
        .unique(),
    );
    expect(row).toMatchObject({
      workspaceId,
      userId,
      provider: "github",
      purpose: "identity",
      returnTo: "/workspaces/x/tasks",
    });
  });
});

describe("identityConnect.completeIdentityConnect", () => {
  it("stores the canonical (trimmed, lowercase) GitHub login on the user row", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId } = await memberOf(t, workspaceId);

    await t.mutation(
      internal.integrations.core.identityConnect.completeIdentityConnect,
      {
        userId,
        provider: "github",
        externalLogin: "  OctoCat ",
        externalUserId: "583231",
      },
    );

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.githubLogin).toBe("octocat");
    // GitHub is addressed by login; the id is not kept.
    expect(user?.gitlabUserId).toBeUndefined();
    expect(user?.gitlabLogin).toBeUndefined();
  });
});

describe("identityConnect.completeIdentityConnect — duplicates", () => {
  it("refuses a GitHub login another user already holds and leaves both rows untouched", async () => {
    const t = createTestContext();
    const { workspaceId, userId: holderId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(holderId, { githubLogin: "octocat" }));
    const { userId: claimantId } = await memberOf(t, workspaceId);

    await expect(
      t.mutation(
        internal.integrations.core.identityConnect.completeIdentityConnect,
        {
          userId: claimantId,
          provider: "github",
          externalLogin: "OctoCat",
          externalUserId: "1",
        },
      ),
    ).rejects.toThrow(/already connected|another/i);

    const holder = await t.run((ctx) => ctx.db.get(holderId));
    const claimant = await t.run((ctx) => ctx.db.get(claimantId));
    expect(holder?.githubLogin).toBe("octocat");
    expect(claimant?.githubLogin).toBeUndefined();
  });

  it("is idempotent for the user who already holds the login", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId } = await memberOf(t, workspaceId);
    await t.run((ctx) => ctx.db.patch(userId, { githubLogin: "octocat" }));

    await t.mutation(
      internal.integrations.core.identityConnect.completeIdentityConnect,
      { userId, provider: "github", externalLogin: "octocat", externalUserId: "1" },
    );
    expect((await t.run((ctx) => ctx.db.get(userId)))?.githubLogin).toBe("octocat");
  });
});

describe("identityConnect.disconnectIdentity", () => {
  it("clears the GitHub login on the caller's own row only", async () => {
    const t = createTestContext();
    const { workspaceId, userId: adminId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) => ctx.db.patch(adminId, { githubLogin: "admin-gh" }));
    const { userId, asUser } = await memberOf(t, workspaceId);
    await t.run((ctx) =>
      ctx.db.patch(userId, { githubLogin: "octocat", gitlabUserId: "7", gitlabLogin: "octo" }),
    );

    await asUser.mutation(
      api.integrations.core.identityConnect.disconnectIdentity,
      { provider: "github" },
    );

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.githubLogin).toBeUndefined();
    // Other provider untouched, other user untouched.
    expect(user?.gitlabUserId).toBe("7");
    expect(user?.gitlabLogin).toBe("octo");
    expect((await t.run((ctx) => ctx.db.get(adminId)))?.githubLogin).toBe("admin-gh");
  });

  it("requires a signed-in user", async () => {
    const t = createTestContext();
    await expect(
      t.mutation(api.integrations.core.identityConnect.disconnectIdentity, {
        provider: "github",
      }),
    ).rejects.toThrow();
  });
});

describe("installFlow.consumeInstallState — purpose", () => {
  it("reports the nonce's purpose so the callback can dispatch on it", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser } = await memberOf(t, workspaceId);
    const { url } = await asUser.mutation(
      api.integrations.core.identityConnect.beginIdentityConnect,
      { provider: "github", workspaceId, returnTo: "/workspaces/x" },
    );
    const nonce = new URL(url).searchParams.get("state")!;

    const resolved = await t.mutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce },
    );
    expect(resolved?.purpose).toBe("identity");
    expect(resolved?.returnTo).toBe("/workspaces/x");
  });

  it("defaults a legacy nonce (no purpose column) to install", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("integrationInstallStates", {
        nonce: "legacy",
        workspaceId,
        userId,
        provider: "github",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const resolved = await t.mutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: "legacy" },
    );
    expect(resolved?.purpose).toBe("install");
  });
});

describe("identity connect — what it unlocks", () => {
  /** A linked task assigned to `assigneeId`, on a GitHub repo link, with GitHub knowing no assignees. */
  async function linkedTaskAssignedTo(
    t: ReturnType<typeof createTestContext>,
    workspaceId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["workspaceId"],
    creatorId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["userId"],
    assigneeId: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["userId"],
  ) {
    const projectId = await setupProject(t, { workspaceId, creatorId });
    return t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        projectId, workspaceId, status: "active", pausedByBilling: false,
        externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Assignee tracer", statusId, priority: "medium",
        completed: false, creatorId: botUserId, assigneeId,
        externalRefs: [{ provider: "github", repoFullName: "acme/web", issueNumber: 42, url: "https://github.com/acme/web/issues/42" }],
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId, externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000, externalState: "open", externalAssigneeLogins: [],
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://github.com/octocat" },
      });
      return taskId;
    });
  }

  it("assignee push is skipped before connecting, enqueued after, skipped again after disconnect", async () => {
    const t = createTestContext();
    const { workspaceId, userId: adminId } = await setupWorkspaceWithAdmin(t);
    const { userId, asUser } = await memberOf(t, workspaceId);
    const taskId = await linkedTaskAssignedTo(t, workspaceId, adminId, userId);
    const runs = () =>
      t.run((ctx) => ctx.db.query("integrationOutboundRuns").collect());

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    expect(await runs()).toHaveLength(0);

    await t.mutation(
      internal.integrations.core.identityConnect.completeIdentityConnect,
      { userId, provider: "github", externalLogin: "OctoCat", externalUserId: "1" },
    );
    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    expect(await runs()).toHaveLength(1);

    await asUser.mutation(api.integrations.core.identityConnect.disconnectIdentity, {
      provider: "github",
    });
    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    expect(await runs()).toHaveLength(1);
  });
});
