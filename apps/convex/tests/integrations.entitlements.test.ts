import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveLinkStatus,
  fanoutPauseByBilling,
  hasFeature,
  type EffectiveLinkStatus,
} from "../convex/integrations/core/entitlements";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import type { Id } from "../convex/_generated/dataModel";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type LinkStatus = "configuring" | "active" | "paused" | "disconnected";

async function insertLink(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    projectId: Id<"projects">;
    status?: LinkStatus;
    pausedByBilling?: boolean;
    externalRepoFullName?: string;
  },
): Promise<Id<"projectIntegrationLinks">> {
  const {
    workspaceId,
    projectId,
    status = "active",
    pausedByBilling = false,
    externalRepoFullName = "test-org/test-repo",
  } = opts;
  return t.run((ctx) =>
    ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status,
      pausedByBilling,
      externalRepoFullName,
      externalRepoId: `repo-${workspaceId}-${projectId}`,
    }),
  );
}

describe("integrations/core/entitlements.hasFeature", () => {
  it("returns false when no entitlement row exists for the workspace+feature", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const result = await t.run((ctx) =>
      hasFeature(ctx, workspaceId, "github_integration"),
    );

    expect(result).toBe(false);
  });

  it("returns true when the entitlement row exists and is enabled", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    await t.run((ctx) =>
      ctx.db.insert("workspaceEntitlements", {
        workspaceId,
        featureKey: "github_integration",
        enabled: true,
      }),
    );

    const result = await t.run((ctx) =>
      hasFeature(ctx, workspaceId, "github_integration"),
    );

    expect(result).toBe(true);
  });

  it("returns false when the entitlement row exists but is disabled", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    await t.run((ctx) =>
      ctx.db.insert("workspaceEntitlements", {
        workspaceId,
        featureKey: "github_integration",
        enabled: false,
      }),
    );

    const result = await t.run((ctx) =>
      hasFeature(ctx, workspaceId, "github_integration"),
    );

    expect(result).toBe(false);
  });
});

describe("integrations/core/entitlements.effectiveLinkStatus", () => {
  it("returns 'active' for an active link that is not paused by billing", () => {
    expect(
      effectiveLinkStatus({ status: "active", pausedByBilling: false }),
    ).toBe("active");
  });

  it("returns 'disconnected' even when paused by billing — disconnect is terminal", () => {
    expect(
      effectiveLinkStatus({ status: "disconnected", pausedByBilling: true }),
    ).toBe("disconnected");
  });

  it("returns 'frozen' when an active link is paused by billing", () => {
    expect(
      effectiveLinkStatus({ status: "active", pausedByBilling: true }),
    ).toBe("frozen");
  });

  it("returns 'paused' for a paused link that is not paused by billing", () => {
    expect(
      effectiveLinkStatus({ status: "paused", pausedByBilling: false }),
    ).toBe("paused");
  });

  // Full truth table — locks the precedence rule against regressions. Every
  // cell is implied by the four `it` blocks above; this exhaustively asserts
  // the matrix as documentation.
  const matrix: ReadonlyArray<{
    status: LinkStatus;
    pausedByBilling: boolean;
    expected: EffectiveLinkStatus;
  }> = [
    { status: "configuring",  pausedByBilling: false, expected: "configuring"  },
    { status: "configuring",  pausedByBilling: true,  expected: "frozen"       },
    { status: "active",       pausedByBilling: false, expected: "active"       },
    { status: "active",       pausedByBilling: true,  expected: "frozen"       },
    { status: "paused",       pausedByBilling: false, expected: "paused"       },
    { status: "paused",       pausedByBilling: true,  expected: "frozen"       },
    { status: "disconnected", pausedByBilling: false, expected: "disconnected" },
    { status: "disconnected", pausedByBilling: true,  expected: "disconnected" },
  ];

  it.each(matrix)(
    "($status, pausedByBilling=$pausedByBilling) → '$expected'",
    ({ status, pausedByBilling, expected }) => {
      expect(effectiveLinkStatus({ status, pausedByBilling })).toBe(expected);
    },
  );
});

describe("integrations/core/entitlements.fanoutPauseByBilling", () => {
  it("sets pausedByBilling=true on a workspace's link when paused=true", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await insertLink(t, {
      workspaceId,
      projectId,
      pausedByBilling: false,
    });

    await t.run((ctx) => fanoutPauseByBilling(ctx, workspaceId, true));

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.pausedByBilling).toBe(true);
  });

  it("flips every link in the workspace, not just one", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const project1 = await setupProject(t, {
      workspaceId,
      creatorId: userId,
      name: "Project 1",
    });
    const project2 = await setupProject(t, {
      workspaceId,
      creatorId: userId,
      name: "Project 2",
    });
    const link1 = await insertLink(t, {
      workspaceId,
      projectId: project1,
      pausedByBilling: false,
    });
    const link2 = await insertLink(t, {
      workspaceId,
      projectId: project2,
      pausedByBilling: false,
    });

    await t.run((ctx) => fanoutPauseByBilling(ctx, workspaceId, true));

    const [l1, l2] = await t.run(async (ctx) => [
      await ctx.db.get(link1),
      await ctx.db.get(link2),
    ]);
    expect(l1?.pausedByBilling).toBe(true);
    expect(l2?.pausedByBilling).toBe(true);
  });

  it("does not touch links belonging to other workspaces", async () => {
    const t = createTestContext();
    const { userId: userA, workspaceId: workspaceA } =
      await setupWorkspaceWithAdmin(t, "Workspace A");
    const { userId: userB, workspaceId: workspaceB } =
      await setupWorkspaceWithAdmin(t, "Workspace B");
    const projectA = await setupProject(t, {
      workspaceId: workspaceA,
      creatorId: userA,
    });
    const projectB = await setupProject(t, {
      workspaceId: workspaceB,
      creatorId: userB,
    });
    const linkA = await insertLink(t, {
      workspaceId: workspaceA,
      projectId: projectA,
      pausedByBilling: false,
    });
    const linkB = await insertLink(t, {
      workspaceId: workspaceB,
      projectId: projectB,
      pausedByBilling: false,
    });

    await t.run((ctx) => fanoutPauseByBilling(ctx, workspaceA, true));

    const [a, b] = await t.run(async (ctx) => [
      await ctx.db.get(linkA),
      await ctx.db.get(linkB),
    ]);
    expect(a?.pausedByBilling).toBe(true);
    expect(b?.pausedByBilling).toBe(false);
  });

  it("restores pausedByBilling=false on a workspace's link when paused=false", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await insertLink(t, {
      workspaceId,
      projectId,
      pausedByBilling: true,
    });

    await t.run((ctx) => fanoutPauseByBilling(ctx, workspaceId, false));

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.pausedByBilling).toBe(false);
  });

  it("flips disconnected links too — the flag must stay accurate for reconnect", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await insertLink(t, {
      workspaceId,
      projectId,
      status: "disconnected",
      pausedByBilling: false,
    });

    await t.run((ctx) => fanoutPauseByBilling(ctx, workspaceId, true));

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.pausedByBilling).toBe(true);
  });
});

describe("integrations/core/entitlements.setWorkspaceFeature", () => {
  it("enabling on a fresh workspace inserts a row with enabled=true and source='manual'", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("workspaceEntitlements")
        .withIndex("by_workspace_feature", (q) =>
          q.eq("workspaceId", workspaceId).eq("featureKey", "github_integration"),
        )
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.enabled).toBe(true);
    expect(row?.source).toBe("manual");
  });

  it("writes an integration.entitlement.granted audit-log entry on enable", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "workspaces",
        resourceId: workspaceId,
      }),
    );
    const granted = logs.find(
      (l: { action: string }) => l.action === "integration.entitlement.granted",
    );
    expect(granted).toBeDefined();
    expect(granted?.actorId).toBe(userId);
    expect(granted?.scope).toBe(workspaceId);
  });

  it("writes an integration.entitlement.revoked audit-log entry on disable", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: false,
    });

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "workspaces",
        resourceId: workspaceId,
      }),
    );
    const revoked = logs.find(
      (l: { action: string }) => l.action === "integration.entitlement.revoked",
    );
    expect(revoked).toBeDefined();
    expect(revoked?.actorId).toBe(userId);
  });

  it("disabling freezes the workspace's currently-active links", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    // Start enabled, then a normal active link.
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });
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

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: false,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.pausedByBilling).toBe(true);
  });

  it("enabling unfreezes the workspace's previously-frozen links", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: true, // currently frozen
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.pausedByBilling).toBe(false);
  });

  it("rejects non-admin workspace members", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
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
        api.integrations.core.entitlements.setWorkspaceFeature,
        {
          workspaceId,
          featureKey: "github_integration",
          enabled: true,
        },
      ),
    ).rejects.toThrow();
  });

  it("disabling an existing-enabled row patches the same row (upsert)", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: true,
    });
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: "github_integration",
      enabled: false,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("workspaceEntitlements")
        .withIndex("by_workspace_feature", (q) =>
          q.eq("workspaceId", workspaceId).eq("featureKey", "github_integration"),
        )
        .collect(),
    );
    // Single row — not a second insert.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
  });
});

// Keep imports live until later cycles use them.
void setupAuthenticatedUser;
void WorkspaceRole;
void auditLog;
