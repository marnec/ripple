import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Enable the `github_integration` feature on the workspace so
 * `completeAppInstallation`'s entitlement gate is satisfied. Uses the
 * production mutation so this matches real flow.
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

describe("integrations/core/install.completeAppInstallation", () => {
  it("happy path: admin install → workspaceIntegrations row + bot user with isBot=true", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const integrationId = await asUser.mutation(
      api.integrations.core.install.completeAppInstallation,
      {
        workspaceId,
        provider: "github",
        externalAccountId: "install-12345",
        externalAccountType: "organization",
        accountLogin: "acme",
      },
    );

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

  it("writes an integration.activated audit-log entry on first install", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    await asUser.mutation(
      api.integrations.core.install.completeAppInstallation,
      {
        workspaceId,
        provider: "github",
        externalAccountId: "install-audit",
        accountLogin: "acme",
      },
    );

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
    const { workspaceId: wsA, asUser: asUserA } =
      await setupWorkspaceWithAdmin(t, "Workspace A");
    const { workspaceId: wsB, asUser: asUserB } =
      await setupWorkspaceWithAdmin(t, "Workspace B");
    await enableGithubFeature(t, { workspaceId: wsA, asUser: asUserA });
    await enableGithubFeature(t, { workspaceId: wsB, asUser: asUserB });

    // Workspace A installs first.
    await asUserA.mutation(
      api.integrations.core.install.completeAppInstallation,
      {
        workspaceId: wsA,
        provider: "github",
        externalAccountId: "install-shared",
      },
    );

    // Workspace B tries to claim the same install id.
    await expect(
      asUserB.mutation(api.integrations.core.install.completeAppInstallation, {
        workspaceId: wsB,
        provider: "github",
        externalAccountId: "install-shared",
      }),
    ).rejects.toThrow(/already claimed/i);
  });

  it("rejects when the workspace has no github_integration entitlement enabled", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    // Deliberately do NOT enable the feature.

    await expect(
      asUser.mutation(api.integrations.core.install.completeAppInstallation, {
        workspaceId,
        provider: "github",
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
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await enableGithubFeature(t, { workspaceId, asUser });

    const args = {
      workspaceId,
      provider: "github",
      externalAccountId: "install-12345",
      externalAccountType: "organization" as const,
      accountLogin: "acme",
    };
    const firstId = await asUser.mutation(
      api.integrations.core.install.completeAppInstallation,
      args,
    );
    const secondId = await asUser.mutation(
      api.integrations.core.install.completeAppInstallation,
      args,
    );

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

void setupAuthenticatedUser;
void WorkspaceRole;
void auditLog;
