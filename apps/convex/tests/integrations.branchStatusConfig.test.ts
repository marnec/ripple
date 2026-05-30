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

describe("integrations/core/links.setRepoTagRules", () => {
  it("normalizes (trim+lowercase), dedupes, and persists tags", async () => {
    const t = createTestContext();
    const { linkId, asUser } = await setup(t);

    await asUser.mutation(api.integrations.core.links.setRepoTagRules, {
      linkId,
      tags: ["  Backend ", "backend", "API", ""],
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.autoSelectTags).toEqual(["backend", "api"]);
  });

  it("clears the rule when given an empty (or all-blank) list", async () => {
    const t = createTestContext();
    const { linkId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setRepoTagRules, {
      linkId,
      tags: ["backend"],
    });

    await asUser.mutation(api.integrations.core.links.setRepoTagRules, {
      linkId,
      tags: ["   "],
    });

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.autoSelectTags).toBeUndefined();
  });

  it("rejects a tag already routed to a sibling repo in the project", async () => {
    const t = createTestContext();
    const { linkId, asUser, workspaceId, projectId } = await setup(t);
    const siblingLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/api",
        externalRepoId: "R_kg2",
      }),
    );
    await asUser.mutation(api.integrations.core.links.setRepoTagRules, {
      linkId: siblingLinkId,
      tags: ["backend"],
    });

    await expect(
      asUser.mutation(api.integrations.core.links.setRepoTagRules, {
        linkId,
        // case-insensitive clash with the sibling's "backend"
        tags: ["Backend"],
      }),
    ).rejects.toThrow(/already routed/);

    // The rejected link keeps no rule.
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.autoSelectTags).toBeUndefined();
  });

  it("surfaces tags through linksForProject", async () => {
    const t = createTestContext();
    const { linkId, projectId, asUser } = await setup(t);
    await asUser.mutation(api.integrations.core.links.setRepoTagRules, {
      linkId,
      tags: ["backend"],
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
    const { linkId } = await setup(t);
    const outsider = t.withIdentity({ subject: "stranger|s", issuer: "test" });

    await expect(
      outsider.mutation(api.integrations.core.links.setRepoTagRules, {
        linkId,
        tags: ["backend"],
      }),
    ).rejects.toThrow();
  });
});
