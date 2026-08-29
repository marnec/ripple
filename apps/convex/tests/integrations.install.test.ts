import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Complete a GitHub install the way the product now does.
 *
 * `completeAppInstallation` no longer accepts `provider: "github"` at all: an
 * installation id arrives on the setup callback's query string and proves
 * nothing on its own, so the only door is the callback, which sets
 * `installationVerified` after `GET /user/installations` confirms the
 * installing user can actually see it. That check has its own tests
 * (`integrations.installProof.test.ts`); the tests below are about the shared
 * completion logic that runs once a claim is allowed through.
 */
async function completeGithubInstall(
  t: ReturnType<typeof createTestContext>,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    externalAccountId: string;
    externalAccountType?: "organization" | "user";
    accountLogin?: string;
    externalBotLogin?: string;
    credentialToken?: string;
  },
) {
  return t.mutation(
    internal.integrations.core.install.completeInstallationFromCallback,
    { ...args, provider: "github", installationVerified: true },
  );
}

/**
 * Enable the `github_integration` feature on the workspace so the
 * entitlement gate is satisfied. Uses the production mutation so this
 * matches real flow.
 */
async function enableGithubFeature(
  t: ReturnType<typeof createTestContext>,
  args: { workspaceId: string; asUser: ReturnType<typeof createTestContext>["withIdentity"] extends never ? never : any },
) {
  await args.asUser.mutation(
    api.integrations.core.entitlements.setWorkspaceFeature,
    {
      workspaceId: args.workspaceId as never,
      featureKey: "github_integration",
      enabled: true,
    },
  );
}

describe("integrations/core/install — shared completion logic", () => {
  it("happy path: admin install → workspaceIntegrations row + bot user with isBot=true", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const integrationId = await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "install-12345",
      externalAccountType: "organization",
      accountLogin: "acme",
    });

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row).toMatchObject({
      workspaceId,
      provider: "github",
      externalAccountId: "install-12345",
      externalAccountType: "organization",
      accountLogin: "acme",
    });
    expect(row?.botUserId).toBeDefined();

    const bot = await t.run((ctx) => ctx.db.get(row!.botUserId));
    expect(bot?.isBot).toBe(true);
  });

  it("persists the provider bot login so the inbound echo guard can match it", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const integrationId = await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "install-bot-login",
      accountLogin: "acme",
      externalBotLogin: "ripple-app-dev[bot]",
    });

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row?.externalBotLogin).toBe("ripple-app-dev[bot]");
  });

  it("stores a provider credential token (GitLab PAT) on the integration row", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    // entitlement helper enables a feature; the token path is provider-neutral
    const integrationId = await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "acct-with-token",
      accountLogin: "acme",
      credentialToken: "glpat-secret",
    });

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row?.credentialToken).toBe("glpat-secret");
  });

  it("writes an integration.activated audit-log entry on first install", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "install-audit",
      accountLogin: "acme",
    });

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "workspaces",
        resourceId: workspaceId,
      }),
    );
    const activated = logs.find(
      (l: { action: string }) => l.action === "integration.activated",
    );
    expect(activated).toBeDefined();
    expect(activated?.actorId).toBe(userId);
    expect(activated?.scope).toBe(workspaceId);
  });

  it("rejects when the externalAccountId is already claimed by another workspace", async () => {
    const t = createTestContext();
    const { workspaceId: wsA, userId: userA, asUser: asUserA } =
      await setupWorkspaceWithAdmin(t, "Workspace A");
    const { workspaceId: wsB, userId: userB, asUser: asUserB } =
      await setupWorkspaceWithAdmin(t, "Workspace B");
    await enableGithubFeature(t, { workspaceId: wsA, asUser: asUserA });
    await enableGithubFeature(t, { workspaceId: wsB, asUser: asUserB });

    // Workspace A installs first.
    await completeGithubInstall(t, {
      workspaceId: wsA,
      userId: userA,
      externalAccountId: "install-shared",
    });

    // Workspace B tries to claim the same install id — even having proven it
    // can see the installation, an account claimed elsewhere stays claimed.
    await expect(
      completeGithubInstall(t, {
        workspaceId: wsB,
        userId: userB,
        externalAccountId: "install-shared",
      }),
    ).rejects.toThrow(/already claimed/i);
  });

  it("rejects when the workspace has no github_integration entitlement enabled", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    // Deliberately do NOT enable the feature.

    await expect(
      completeGithubInstall(t, {
        workspaceId,
        userId,
        externalAccountId: "install-no-entitlement",
      }),
    ).rejects.toThrow(/github_integration/i);
  });

  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "m@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      asMember.mutation(
        api.integrations.core.install.completeAppInstallation,
        {
          workspaceId,
          provider: "github",
          externalAccountId: "install-99",
        },
      ),
    ).rejects.toThrow();
  });

  it("is idempotent: re-running with same (workspaceId, externalAccountId) returns the existing id and creates no duplicate bot user", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const args = {
      workspaceId,
      userId,
      externalAccountId: "install-12345",
      externalAccountType: "organization" as const,
      accountLogin: "acme",
    };
    const firstId = await completeGithubInstall(t, args);
    const secondId = await completeGithubInstall(t, args);

    expect(secondId).toBe(firstId);

    const integrationRows = await t.run((ctx) =>
      ctx.db
        .query("workspaceIntegrations")
        .withIndex("by_externalAccount", (q) =>
          q.eq("externalAccountId", "install-12345"),
        )
        .collect(),
    );
    expect(integrationRows).toHaveLength(1);

    const botUsers = await t.run((ctx) =>
      ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("isBot"), true))
        .collect(),
    );
    expect(botUsers).toHaveLength(1);
  });
});

describe("integrations/core/install — installedBy", () => {
  it("records the installing admin's userId on the integration row", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const integrationId = await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "install-by-test",
      accountLogin: "acme",
      },
    );

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row?.installedBy).toBe(userId);
  });
});

describe("integrations/core/install.completeInstallationFromCallback", () => {
  it("creates the integration row for an admin resolved from the install nonce", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const integrationId = await t.mutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId,
        userId,
        provider: "github",
        externalAccountId: "cb-install-1",
        externalAccountType: "organization",
        accountLogin: "acme",
        installationVerified: true,
      },
    );

    const row = await t.run((ctx) => ctx.db.get(integrationId));
    expect(row?.externalAccountId).toBe("cb-install-1");
    expect(row?.installedBy).toBe(userId);
  });

  it("rejects when the resolved user is not a workspace admin", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "cb-member@test.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      t.mutation(
        internal.integrations.core.install.completeInstallationFromCallback,
        {
          workspaceId,
          userId: memberId,
          provider: "github",
          externalAccountId: "cb-install-2",
        },
      ),
    ).rejects.toThrow();
  });
});

describe("integrations/core/install.listInstallations", () => {
  it("lists the workspace's installations with account + installer metadata", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });
    await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "install-aaa",
      externalAccountType: "organization",
      accountLogin: "acme",
    });

    const rows = await asUser.query(
      api.integrations.core.install.listInstallations,
      { workspaceId },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalAccountId).toBe("install-aaa");
    expect(rows[0]?.accountLogin).toBe("acme");
    expect(rows[0]?.externalAccountType).toBe("organization");
    expect(rows[0]?.installedBy).toBe(userId);
  });

  /**
   * A workspace can hold a GitHub install and a GitLab install for accounts
   * with the same login — the reported symptom was two identical "marnec
   * (user)" rows in the GitHub wizard's account step, one of which was the
   * GitLab account. Picking it would have sent a GitLab account id to a
   * GitHub-token-minting action.
   */
  it("filters to one provider when asked, so a picker never offers the other's accounts", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });
    await asUser.mutation(
      api.integrations.core.entitlements.setWorkspaceFeature,
      { workspaceId, featureKey: "gitlab_integration", enabled: true },
    );

    await completeGithubInstall(t, {
      workspaceId,
      userId,
      externalAccountId: "gh-1",
      externalAccountType: "user",
      accountLogin: "marnec",
    });
    await t.mutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId,
        userId,
        provider: "gitlab",
        externalAccountId: "gl-1",
        externalAccountType: "user",
        accountLogin: "marnec",
      },
    );

    const all = await asUser.query(
      api.integrations.core.install.listInstallations,
      { workspaceId },
    );
    expect(all).toHaveLength(2);

    const github = await asUser.query(
      api.integrations.core.install.listInstallations,
      { workspaceId, provider: "github" },
    );
    expect(github.map((r) => r.externalAccountId)).toEqual(["gh-1"]);

    const gitlab = await asUser.query(
      api.integrations.core.install.listInstallations,
      { workspaceId, provider: "gitlab" },
    );
    expect(gitlab.map((r) => r.externalAccountId)).toEqual(["gl-1"]);
  });

  /**
   * The picker bug's downstream half: `assertWizardInstallation` is what stands
   * between a caller-supplied account id and a GitHub App token being minted
   * for it. It checked the workspace but not the provider, so a GitLab account
   * id from the same workspace passed the gate.
   */
  it("assertWizardInstallation refuses an installation from another provider", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(
      api.integrations.core.entitlements.setWorkspaceFeature,
      { workspaceId, featureKey: "gitlab_integration", enabled: true },
    );
    await t.mutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId,
        userId,
        provider: "gitlab",
        externalAccountId: "gl-only",
        accountLogin: "marnec",
      },
    );

    await expect(
      asUser.query(internal.integrations.core.install.assertWizardInstallation, {
        workspaceId,
        externalAccountId: "gl-only",
        provider: "github",
      }),
    ).rejects.toThrow(/not found in this workspace/i);
  });

  it("rejects non-members", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      name: "Outsider",
      email: "li-outsider@test.com",
    });

    await expect(
      asOutsider.query(api.integrations.core.install.listInstallations, {
        workspaceId,
      }),
    ).rejects.toThrow();
  });
});

void setupAuthenticatedUser;
void WorkspaceRole;
void auditLog;
