import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Project + triage status + installed account + active link, returning the
 * linkId the wizard would pass to `startGithubImport`.
 */
async function setupLinkedProject(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const linkId = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-imp",
    });
    return ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
  });
  return { userId, workspaceId, projectId, asUser, linkId };
}

describe("integrations startGithubImport", () => {
  it("creates a github_integration import job with the expected total + link", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser, linkId } =
      await setupLinkedProject(t);

    const { jobId } = await asUser.mutation(
      api.integrations.github.importStart.startGithubImport,
      { projectIntegrationLinkId: linkId, includeClosed: false, labels: [], expectedTotal: 42 },
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.sourceType).toBe("github_integration");
    expect(job?.projectIntegrationLinkId).toBe(linkId);
    expect(job?.totalRows).toBe(42);
    expect(job?.workspaceId).toBe(workspaceId);
    expect(job?.projectId).toBe(projectId);
  });

  it("writes an integration.import_started audit log entry", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId, asUser, linkId } =
      await setupLinkedProject(t);

    await asUser.mutation(
      api.integrations.github.importStart.startGithubImport,
      { projectIntegrationLinkId: linkId, includeClosed: false, labels: [], expectedTotal: 1 },
    );

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      }),
    );
    const started = logs.find(
      (l: { action: string }) => l.action === "integration.import_started",
    );
    expect(started).toBeDefined();
    expect(started?.actorId).toBe(userId);
    expect(started?.scope).toBe(workspaceId);
  });

  it("rejects non-admin members", async () => {
    const t = createTestContext();
    const { workspaceId, linkId } = await setupLinkedProject(t);
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { name: "Member", email: "imp-member@test.com" },
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
        api.integrations.github.importStart.startGithubImport,
        { projectIntegrationLinkId: linkId, includeClosed: false, labels: [], expectedTotal: 1 },
      ),
    ).rejects.toThrow();
  });
});

void (null as unknown as Id<"projectIntegrationLinks">);
