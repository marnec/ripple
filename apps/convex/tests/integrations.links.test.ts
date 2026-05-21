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

  it("one project ↔ N repos: the same project can link multiple distinct repos", async () => {
    // An "app" project gathering a frontend repo and a backend repo. Each
    // repo maps to one project (repo→one-project still holds), but a project
    // accumulates as many repos as you link. Guards against a per-project
    // uniqueness check ever being added.
    const t = createTestContext();
    const { workspaceId, projectId, asUser } =
      await setupActivatableProject(t);

    const frontendLinkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_frontend",
        externalRepoFullName: "acme/web-frontend",
      },
    );
    const backendLinkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_backend",
        externalRepoFullName: "acme/web-backend",
      },
    );

    const [frontend, backend] = await t.run(async (ctx) => [
      await ctx.db.get(frontendLinkId),
      await ctx.db.get(backendLinkId),
    ]);
    expect(frontend?.projectId).toBe(projectId);
    expect(backend?.projectId).toBe(projectId);
    expect(frontend?.status).toBe("active");
    expect(backend?.status).toBe("active");
    expect(frontend?.externalRepoId).not.toBe(backend?.externalRepoId);

    // The workspace view lists both repos under the one project.
    const links = await asUser.query(
      api.integrations.core.links.listByWorkspace,
      { workspaceId },
    );
    const reposForProject = links
      .filter((l) => l.projectId === projectId)
      .map((l) => l.externalRepoFullName)
      .sort();
    expect(reposForProject).toEqual([
      "acme/web-backend",
      "acme/web-frontend",
    ]);
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

describe("integrations/core/links.pauseLink / resumeLink", () => {
  async function createActiveLink(t: ReturnType<typeof createTestContext>) {
    const fixtures = await setupActivatableProject(t);
    const linkId = await fixtures.asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId: fixtures.projectId,
        workspaceId: fixtures.workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      },
    );
    return { ...fixtures, linkId };
  }

  it("admin pauses an active link → status='paused'; audit log entry written", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser, linkId } =
      await createActiveLink(t);

    await asUser.mutation(api.integrations.core.links.pauseLink, { linkId });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("paused");

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const paused = logs.find(
      (l: { action: string }) => l.action === "integration.paused",
    );
    expect(paused).toBeDefined();
    expect(paused?.actorId).toBe(userId);
    expect(paused?.scope).toBe(workspaceId);
  });

  it("admin resumes a paused link → status='active'; audit log entry written", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser, linkId } =
      await createActiveLink(t);
    await asUser.mutation(api.integrations.core.links.pauseLink, { linkId });

    await asUser.mutation(api.integrations.core.links.resumeLink, { linkId });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("active");

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const resumed = logs.find(
      (l: { action: string }) => l.action === "integration.resumed",
    );
    expect(resumed).toBeDefined();
    expect(resumed?.actorId).toBe(userId);
    expect(resumed?.scope).toBe(workspaceId);
  });

  it("pauseLink rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, linkId } = await createActiveLink(t);
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "m3@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );
    await expect(
      asMember.mutation(api.integrations.core.links.pauseLink, { linkId }),
    ).rejects.toThrow();
  });

  it("resumeLink on a disconnected link is rejected (terminal state)", async () => {
    const t = createTestContext();
    const { asUser, linkId } = await createActiveLink(t);
    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });

    await expect(
      asUser.mutation(api.integrations.core.links.resumeLink, { linkId }),
    ).rejects.toThrow(/disconnected/i);
  });
});

describe("integrations/core/links.forceResync", () => {
  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      },
    );
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "fr-member@test.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await expect(
      asMember.mutation(api.integrations.core.links.forceResync, { linkId }),
    ).rejects.toThrow();
  });

  it("rejects a frozen link with a clear error", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: true,
        frozenAt: Date.UTC(2026, 4, 17, 12, 0, 0),
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.forceResync, { linkId }),
    ).rejects.toThrow(/froz/i);
  });

  it("rejects a disconnected link", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "disconnected",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.forceResync, { linkId }),
    ).rejects.toThrow(/disconnect/i);
  });

  it("admin on an active link → writes an integration.force_resync audit log entry", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser } =
      await setupActivatableProject(t);
    const linkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      },
    );

    await asUser.mutation(api.integrations.core.links.forceResync, { linkId });

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const entry = logs.find(
      (l: { action: string }) => l.action === "integration.force_resync",
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(userId);
    expect(entry?.scope).toBe(workspaceId);
  });
});

describe("integrations/core/links.listByWorkspace", () => {
  it("exposes frozenAt for frozen links so the client can render the >24h banner", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: true,
        frozenAt: Date.UTC(2026, 4, 17, 12, 0, 0),
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    const rows = await asUser.query(
      api.integrations.core.links.listByWorkspace,
      { workspaceId },
    );

    const row = rows.find((r) => r._id === linkId);
    expect(row?.frozenAt).toBe(Date.UTC(2026, 4, 17, 12, 0, 0));
  });

  it("returns frozenAt=undefined for unfrozen links", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } = await setupActivatableProject(t);
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    const rows = await asUser.query(
      api.integrations.core.links.listByWorkspace,
      { workspaceId },
    );

    const row = rows.find((r) => r._id === linkId);
    expect(row?.frozenAt).toBeUndefined();
  });
});

void setupAuthenticatedUser;
void WorkspaceRole;
void (null as unknown as Id<"projectIntegrationLinks">);
