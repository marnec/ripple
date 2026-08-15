import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { withTriggers } from "../convex/dbTriggers";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Generate a throwaway RSA PEM so the action's JWT signing succeeds. */
async function generateTestKeyPem(): Promise<string> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** The operator surface `backgroundJobFailures` is read through. */
async function makePlatformAdmin(t: ReturnType<typeof createTestContext>) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email: "ops-rm@test.com",
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return asUser;
}

/**
 * A workspace with a connected provider account, one linked repo, and one task
 * carrying an external ref — i.e. everything removal has to unwind.
 */
async function setupInstalled(
  t: ReturnType<typeof createTestContext>,
  opts: { provider?: "github" | "gitlab"; credentialToken?: string } = {},
) {
  const { provider = "github", credentialToken } = opts;
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  await asUser.mutation(
    api.integrations.core.entitlements.setWorkspaceFeature,
    { workspaceId, featureKey: `${provider}_integration`, enabled: true },
  );

  const integrationId = await t.mutation(
    internal.integrations.core.install.completeInstallationFromCallback,
    {
      workspaceId,
      userId,
      provider,
      externalAccountId: "42",
      externalAccountType: "organization",
      accountLogin: "acme",
      credentialToken,
      installationVerified: provider === "github" ? true : undefined,
    },
  );

  const { linkId, taskId } = await t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      workspaceIntegrationId: integrationId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId,
      workspaceId,
      title: "linked task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      externalRefs: [
        {
          provider,
          repoFullName: "acme/web",
          issueNumber: 7,
          url: "https://example.com/acme/web/issues/7",
        },
      ],
    });
    await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: linkId,
      externalIssueId: "I_kwDOABC0",
      externalUpdatedAt: 1_700_000_000_000,
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://example.com/octocat.png",
        url: "https://example.com/octocat",
      },
    });
    return { linkId, taskId };
  });

  return { userId, workspaceId, projectId, asUser, integrationId, linkId, taskId };
}

describe("removing a provider installation", () => {
  const fetchMock = vi.fn();
  let keyPem: string;

  beforeEach(async () => {
    keyPem = await generateTestKeyPem();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.GITHUB_APP_ID = "3807481";
    process.env.GITHUB_APP_PRIVATE_KEY = keyPem;
    process.env.GITLAB_OAUTH_CLIENT_ID = "gl-client";
    process.env.GITLAB_OAUTH_CLIENT_SECRET = "gl-secret";
    // Convex injects this in a real deployment; convex-test does not, and
    // `gitlabOAuthFromEnv` derives its redirect URI from it.
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITLAB_OAUTH_CLIENT_ID;
    delete process.env.GITLAB_OAUTH_CLIENT_SECRET;
    delete process.env.CONVEX_SITE_URL;
  });

  it("unwinds the whole thing: links disconnected, tasks frozen, row gone", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, integrationId, linkId, taskId } =
      await setupInstalled(t);

    await asUser.action(api.integrations.core.removeInstallation.remove, {
      workspaceId,
      integrationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The link is disconnected and its per-task rows are gone.
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");
    const taskLinks = await t.run((ctx) =>
      ctx.db.query("taskIntegrationLinks").collect(),
    );
    expect(taskLinks).toHaveLength(0);

    // The task survives, carrying the frozen history — with the RIGHT provider.
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task).not.toBeNull();
    expect(task!.externalRefFrozen?.provider).toBe("github");

    // And the installation itself is gone.
    expect(await t.run((ctx) => ctx.db.get(integrationId))).toBeNull();
  });

  it("uninstalls the App on GitHub rather than only forgetting it locally", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, integrationId } = await setupInstalled(t);

    await asUser.action(api.integrations.core.removeInstallation.remove, {
      workspaceId,
      integrationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/app/installations/42"),
    );
    expect(call).toBeDefined();
    expect(call![1]?.method).toBe("DELETE");
    expect(
      new Headers(call![1]?.headers).get("authorization"),
    ).toMatch(/^Bearer /);
  });

  it("still completes locally when the provider call fails", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, integrationId } = await setupInstalled(t);
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    await asUser.action(api.integrations.core.removeInstallation.remove, {
      workspaceId,
      integrationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // A GitHub outage must not strand the workspace with an integration it
    // cannot remove — local state is the part we control.
    expect(await t.run((ctx) => ctx.db.get(integrationId))).toBeNull();
  });

  it("revokes the stored token when removing a GitLab account", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, integrationId } = await setupInstalled(t, {
      provider: "gitlab",
      credentialToken: "gl-access-token",
    });

    await asUser.action(api.integrations.core.removeInstallation.remove, {
      workspaceId,
      integrationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/oauth/revoke"),
    );
    expect(call).toBeDefined();
    expect(String(call![1]?.body ?? "")).toContain("gl-access-token");
    expect(await t.run((ctx) => ctx.db.get(integrationId))).toBeNull();
  });

  it("freezes GitLab tasks as gitlab, not as the default provider", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, integrationId, taskId } = await setupInstalled(
      t,
      { provider: "gitlab", credentialToken: "gl-access-token" },
    );

    await asUser.action(api.integrations.core.removeInstallation.remove, {
      workspaceId,
      integrationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // `resolveProvider(null)` falls back to "github", so deleting the
    // integration row before the cascade drains would silently mislabel every
    // frozen ref on a GitLab disconnect.
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task!.externalRefFrozen?.provider).toBe("gitlab");
  });

  /**
   * The runaway branch. `finishRemoveInstallation` waits for the disconnect
   * cascade by re-reading it and re-scheduling itself, and the cascade is a
   * scheduled mutation — so a deterministic failure inside it (a transaction
   * cap while freezing a task with many comment links, a validation throw) is
   * terminal, and the `taskIntegrationLinks` rows it was clearing never
   * disappear. The waiter then had no terminator at all: an endless chain of
   * scheduled mutations, at 0 ms, for the life of the deployment.
   *
   * A dead cascade is exactly the state below — the rows survive because
   * nothing is draining them.
   */
  it("stops waiting on a dead cascade, and reports the stranded installation", async () => {
    const t = createTestContext();
    const { integrationId } = await setupInstalled(t);
    const asAdmin = await makePlatformAdmin(t);

    await t.mutation(
      internal.integrations.core.install.finishRemoveInstallation,
      { integrationId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: "integrations.install:finishRemoveInstallation",
      key: integrationId,
    });

    // The row is deliberately left behind rather than deleted: the cascade
    // never froze those tasks, and `resolveProvider(null)` would mislabel
    // every one of them if the integration went first.
    expect(await t.run((ctx) => ctx.db.get(integrationId))).not.toBeNull();
  });

  /**
   * The other half of the bound, and the reason it counts stalls rather than
   * attempts. Giving up is not free: the installation row is left behind and
   * an operator is told the disconnect is stuck. A wall-clock cap would do
   * that to a workspace whose only crime is a large repo — the cascade clears
   * 50 task links per transaction, so a six-figure disconnect legitimately
   * outlasts any fixed number of polls. A cascade that is still moving must
   * therefore never be abandoned, however many polls it takes.
   */
  it("keeps waiting while the cascade is still moving, however long that takes", async () => {
    const t = createTestContext();
    const { integrationId, linkId, taskId } = await setupInstalled(t);
    const asAdmin = await makePlatformAdmin(t);

    // Far more polls than any stall budget would allow.
    const POLLS = 20;
    await t.run(async (ctx) => {
      for (let i = 0; i < POLLS; i++) {
        await ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: linkId,
          externalIssueId: `I_extra_${String(i).padStart(3, "0")}`,
          externalUpdatedAt: 1_700_000_000_000,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://example.com/octocat.png",
            url: "https://example.com/octocat",
          },
        });
      }
    });

    /** Whatever the last poll queued for itself, or null if it gave up. */
    async function nextPollArgs() {
      const rows = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const polls = rows.filter((r) =>
        r.name.endsWith("finishRemoveInstallation"),
      );
      return polls.length ? (polls[polls.length - 1].args[0] as never) : null;
    }

    /** One batch of the cascade landing: the frontier row goes. */
    async function cascadeMakesProgress() {
      await t.run(async (ctx) => {
        const first = await ctx.db
          .query("taskIntegrationLinks")
          .withIndex("by_link_externalIssueId", (q) =>
            q.eq("projectIntegrationLinkId", linkId),
          )
          .first();
        if (first) await ctx.db.delete(first._id);
      });
    }

    let args: unknown = { integrationId };
    for (let i = 0; i < POLLS; i++) {
      await t.mutation(
        internal.integrations.core.install.finishRemoveInstallation,
        args as never,
      );
      const queued = await nextPollArgs();
      expect(queued, `gave up on poll ${i} while the cascade was moving`).not.
        toBeNull();
      args = queued;
      await cascadeMakesProgress();
    }

    expect((await asAdmin.query(api.admin.jobs.list, {})).failures).toEqual([]);

    // And once the cascade finally drains, the wait ends the way it should.
    await cascadeMakesProgress(); // the row `setupInstalled` seeded
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(integrationId))).toBeNull();
  });

  it("refuses a non-admin member", async () => {
    const t = createTestContext();
    const { workspaceId, integrationId } = await setupInstalled(t);
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "rm-member@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      asMember.action(api.integrations.core.removeInstallation.remove, {
        workspaceId,
        integrationId,
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(integrationId))).not.toBeNull();
  });

  it("refuses an installation belonging to another workspace", async () => {
    const t = createTestContext();
    const { integrationId } = await setupInstalled(t);
    const attacker = await setupWorkspaceWithAdmin(t, "Attacker workspace");

    await expect(
      attacker.asUser.action(api.integrations.core.removeInstallation.remove, {
        workspaceId: attacker.workspaceId,
        integrationId: integrationId as Id<"workspaceIntegrations">,
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(integrationId))).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
