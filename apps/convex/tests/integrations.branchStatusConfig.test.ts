import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const { linkId, stagingStatusId, releasedStatusId } = await t.run(
    async (ctx) => {
      const stagingStatusId = await ctx.db.insert("taskStatuses", {
        projectId,
        name: "On Staging",
        color: "bg-gray-500",
        order: 1,
        isDefault: false,
        isCompleted: false,
      });
      const releasedStatusId = await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Released",
        color: "bg-green-500",
        order: 2,
        isDefault: false,
        isCompleted: true,
      });
      const linkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kg1",
      });
      return { linkId, stagingStatusId, releasedStatusId };
    },
  );
  return { workspaceId, projectId, linkId, stagingStatusId, releasedStatusId, asUser };
}

describe("integrations/core/links.setBranchStatusMap", () => {
  it("persists the branch→status entries on the link", async () => {
    const t = createTestContext();
    const { linkId, stagingStatusId, releasedStatusId, asUser } = await setup(t);

    await asUser.mutation(api.integrations.core.links.setBranchStatusMap, {
      linkId,
      entries: [
        { branch: "develop", statusId: stagingStatusId },
        { branch: "main", statusId: releasedStatusId },
      ],
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.branchStatusMap).toEqual([
      { branch: "develop", statusId: stagingStatusId },
      { branch: "main", statusId: releasedStatusId },
    ]);
  });

  it("replaces the whole map (empty clears it)", async () => {
    const t = createTestContext();
    const { linkId, stagingStatusId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setBranchStatusMap, {
      linkId,
      entries: [{ branch: "develop", statusId: stagingStatusId }],
    });

    await asUser.mutation(api.integrations.core.links.setBranchStatusMap, {
      linkId,
      entries: [],
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.branchStatusMap).toEqual([]);
  });

  it("rejects a status from a different project", async () => {
    const t = createTestContext();
    const { linkId, asUser, workspaceId } = await setup(t);
    const otherProjectId = await setupProject(t, {
      workspaceId,
      creatorId: (await setupWorkspaceWithAdmin(t)).userId,
      name: "Other",
    });
    const foreignStatusId: Id<"taskStatuses"> = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId: otherProjectId,
        name: "X",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.setBranchStatusMap, {
        linkId,
        entries: [{ branch: "main", statusId: foreignStatusId }],
      }),
    ).rejects.toThrow();
  });

  it("rejects non-admin callers", async () => {
    const t = createTestContext();
    const { linkId, stagingStatusId } = await setup(t);
    const outsider = t.withIdentity({ subject: "stranger|s", issuer: "test" });

    await expect(
      outsider.mutation(api.integrations.core.links.setBranchStatusMap, {
        linkId,
        entries: [{ branch: "main", statusId: stagingStatusId }],
      }),
    ).rejects.toThrow();
  });
});

describe("integrations/core/links.setBranchSourceDefaults", () => {
  it("persists the default base branch and ask-each-time flag", async () => {
    const t = createTestContext();
    const { linkId, asUser } = await setup(t);

    await asUser.mutation(api.integrations.core.links.setBranchSourceDefaults, {
      linkId,
      defaultBaseBranch: "develop",
      askEachTime: false,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.defaultBaseBranch).toBe("develop");
    expect(link?.askBranchSourceEachTime).toBe(false);
  });

  it("clears the default base branch when given null or blank", async () => {
    const t = createTestContext();
    const { linkId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setBranchSourceDefaults, {
      linkId,
      defaultBaseBranch: "develop",
      askEachTime: false,
    });

    await asUser.mutation(api.integrations.core.links.setBranchSourceDefaults, {
      linkId,
      defaultBaseBranch: "   ",
      askEachTime: true,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.defaultBaseBranch).toBeUndefined();
    expect(link?.askBranchSourceEachTime).toBe(true);
  });

  it("rejects non-admin callers", async () => {
    const t = createTestContext();
    const { linkId } = await setup(t);
    const outsider = t.withIdentity({ subject: "stranger|s", issuer: "test" });

    await expect(
      outsider.mutation(api.integrations.core.links.setBranchSourceDefaults, {
        linkId,
        defaultBaseBranch: "develop",
        askEachTime: false,
      }),
    ).rejects.toThrow();
  });
});

describe("integrations/core/links.setInboundIssueSync", () => {
  it("disabling sets the flag; re-enabling clears it (absent = syncing)", async () => {
    const t = createTestContext();
    const { linkId, asUser } = await setup(t);

    await asUser.mutation(api.integrations.core.links.setInboundIssueSync, {
      linkId,
      enabled: false,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(linkId)))?.inboundIssueSyncDisabled,
    ).toBe(true);

    await asUser.mutation(api.integrations.core.links.setInboundIssueSync, {
      linkId,
      enabled: true,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(linkId)))?.inboundIssueSyncDisabled,
    ).toBeUndefined();
  });

  it("rejects non-admin callers", async () => {
    const t = createTestContext();
    const { linkId } = await setup(t);
    const outsider = t.withIdentity({ subject: "stranger|s", issuer: "test" });

    await expect(
      outsider.mutation(api.integrations.core.links.setInboundIssueSync, {
        linkId,
        enabled: false,
      }),
    ).rejects.toThrow();
  });
});

describe("integrations/core/links.setTagRoutingRule", () => {
  async function withSibling(t: ReturnType<typeof createTestContext>) {
    const ctx = await setup(t);
    const siblingLinkId = await t.run((c) =>
      c.db.insert("projectIntegrationLinks", {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/api",
        externalRepoId: "R_kg2",
      }),
    );
    return { ...ctx, siblingLinkId };
  }

  it("routes a normalized tag to the chosen link", async () => {
    const t = createTestContext();
    const { linkId, projectId, asUser } = await setup(t);

    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "  Backend ",
      linkId,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.autoSelectTags).toEqual(["backend"]);
  });

  it("moves a tag between repos atomically (strips the old claim)", async () => {
    const t = createTestContext();
    const { linkId, siblingLinkId, projectId, asUser } = await withSibling(t);

    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "backend",
      linkId,
    });
    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "backend",
      linkId: siblingLinkId,
    });

    const from = await t.run((ctx) => ctx.db.get(linkId));
    const to = await t.run((ctx) => ctx.db.get(siblingLinkId));
    expect(from?.autoSelectTags).toBeUndefined();
    expect(to?.autoSelectTags).toEqual(["backend"]);
  });

  it("clears a tag's routing when linkId is null", async () => {
    const t = createTestContext();
    const { linkId, projectId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "backend",
      linkId,
    });

    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "backend",
      linkId: null,
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.autoSelectTags).toBeUndefined();
  });

  it("rejects a link that belongs to another project", async () => {
    const t = createTestContext();
    const { projectId, asUser, workspaceId } = await setup(t);
    const otherProjectId = await setupProject(t, {
      workspaceId,
      creatorId: (await setupWorkspaceWithAdmin(t)).userId,
      name: "Other",
    });
    const foreignLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId: otherProjectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/other",
        externalRepoId: "R_kg9",
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
        projectId,
        tag: "backend",
        linkId: foreignLinkId,
      }),
    ).rejects.toThrow();
  });

  it("surfaces tags through linksForProject", async () => {
    const t = createTestContext();
    const { linkId, projectId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setTagRoutingRule, {
      projectId,
      tag: "backend",
      linkId,
    });

    const links = await asUser.query(
      api.integrations.core.links.linksForProject,
      { projectId },
    );
    expect(links.find((l) => l._id === linkId)?.autoSelectTags).toEqual([
      "backend",
    ]);
  });

  it("rejects non-admin callers", async () => {
    const t = createTestContext();
    const { linkId, projectId } = await setup(t);
    const outsider = t.withIdentity({ subject: "stranger|s", issuer: "test" });

    await expect(
      outsider.mutation(api.integrations.core.links.setTagRoutingRule, {
        projectId,
        tag: "backend",
        linkId,
      }),
    ).rejects.toThrow();
  });
});
