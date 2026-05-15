import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

// Mirrors tasks.test.ts: audit log component's deferred aggregate updates
// must not fire on real timers and corrupt convex-test state.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setupActivatableProject(
  t: ReturnType<typeof createTestContext>,
) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  // The activation gate requires a triage status. Seed one directly.
  await t.run((ctx) =>
    ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    }),
  );
  // The createLink mutation also requires a workspaceIntegrations row for
  // the (workspaceId, externalAccountId) pair — represents an installed
  // GitHub App account.
  const botUserId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "GitHub" }),
  );
  await t.run((ctx) =>
    ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-999",
    }),
  );
  return { userId, workspaceId, projectId, asUser };
}

describe("integrations/core/links.createLink", () => {
  it("happy path: admin creates a link → row with status=active, pausedByBilling=false; audit log entry written", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser } =
      await setupActivatableProject(t);

    const linkId = await asUser.mutation(api.integrations.core.links.createLink, {
      projectId,
      workspaceId,
      externalAccountId: "install-999",
      externalRepoId: "R_kgDOACME",
      externalRepoFullName: "acme/web",
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link).toMatchObject({
      projectId,
      workspaceId,
      status: "active",
      pausedByBilling: false,
      externalRepoId: "R_kgDOACME",
      externalRepoFullName: "acme/web",
    });

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const linked = logs.find(
      (l: { action: string }) => l.action === "integration.repo_linked",
    );
    expect(linked).toBeDefined();
    expect(linked?.actorId).toBe(userId);
    expect(linked?.scope).toBe(workspaceId);
  });

  it("rejects when the repo is already linked to a different project (globally unique externalRepoId)", async () => {
    const t = createTestContext();
    const {
      userId,
      workspaceId,
      projectId: firstProjectId,
      asUser,
    } = await setupActivatableProject(t);

    // First link — succeeds.
    await asUser.mutation(api.integrations.core.links.createLink, {
      projectId: firstProjectId,
      workspaceId,
      externalAccountId: "install-999",
      externalRepoId: "R_kgDOSHARED",
      externalRepoFullName: "acme/web",
    });

    // A second project in the same workspace tries to link the SAME repo.
    const secondProjectId = await setupProject(t, {
      workspaceId,
      creatorId: userId,
      name: "Second",
      key: "SEC",
    });
    await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId: secondProjectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 0,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.createLink, {
        projectId: secondProjectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOSHARED",
        externalRepoFullName: "acme/web",
      }),
    ).rejects.toThrow(new RegExp(firstProjectId));
  });

  it("rejects when no workspaceIntegrations row exists for the externalAccountId", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);

    await expect(
      asUser.mutation(api.integrations.core.links.createLink, {
        projectId,
        workspaceId,
        externalAccountId: "install-NOT-INSTALLED",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      }),
    ).rejects.toThrow(/install/i);
  });

  it("rejects when the project has no triage status (activation gate)", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    // Project deliberately created WITHOUT a triage status.
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub" }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-999",
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.createLink, {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      }),
    ).rejects.toThrow(/triage/i);
  });

  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, projectId } = await setupActivatableProject(t);
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
      asMember.mutation(api.integrations.core.links.createLink, {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      }),
    ).rejects.toThrow();
  });
});

describe("integrations/core/links.unlinkLink", () => {
  it("happy path: admin unlinks → status='disconnected'; audit log entry written", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser } =
      await setupActivatableProject(t);
    const linkId = await asUser.mutation(api.integrations.core.links.createLink, {
      projectId,
      workspaceId,
      externalAccountId: "install-999",
      externalRepoId: "R_kgDOACME",
      externalRepoFullName: "acme/web",
    });

    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const unlinked = logs.find(
      (l: { action: string }) => l.action === "integration.repo_unlinked",
    );
    expect(unlinked).toBeDefined();
    expect(unlinked?.actorId).toBe(userId);
    expect(unlinked?.scope).toBe(workspaceId);
  });

  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOFOR_MEMBER_TEST",
        externalRepoFullName: "acme/web2",
      },
    );

    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "m2@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      asMember.mutation(api.integrations.core.links.unlinkLink, { linkId }),
    ).rejects.toThrow();
  });
});

void setupAuthenticatedUser;
void WorkspaceRole;
void (null as unknown as Id<"projectIntegrationLinks">);
