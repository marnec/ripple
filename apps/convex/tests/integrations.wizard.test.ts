import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import {
  buildIssueSearchQuery,
  shapeRepos,
} from "../convex/integrations/github/wizardHelpers";

describe("integrations/github/wizardHelpers.shapeRepos", () => {
  it("maps raw GitHub repositories to the wizard's repo shape", () => {
    const shaped = shapeRepos([
      {
        node_id: "R_kgDOACME",
        full_name: "acme/web",
        private: true,
      },
      {
        node_id: "R_kgDOBETA",
        full_name: "acme/api",
        private: false,
      },
    ]);

    expect(shaped).toEqual([
      { externalRepoId: "R_kgDOACME", fullName: "acme/web", private: true },
      { externalRepoId: "R_kgDOBETA", fullName: "acme/api", private: false },
    ]);
  });

  it("returns an empty array for no repos", () => {
    expect(shapeRepos([])).toEqual([]);
  });
});

describe("integrations/github/wizardHelpers.buildIssueSearchQuery", () => {
  it("defaults to open issues only, scoped to the repo, excluding PRs", () => {
    const q = buildIssueSearchQuery({
      repoFullName: "acme/web",
      includeClosed: false,
      labels: [],
    });
    expect(q).toBe("repo:acme/web type:issue state:open");
  });

  it("omits the state filter when closed issues are included", () => {
    const q = buildIssueSearchQuery({
      repoFullName: "acme/web",
      includeClosed: true,
      labels: [],
    });
    expect(q).toBe("repo:acme/web type:issue");
  });

  it("adds a label qualifier per label, quoting labels with spaces", () => {
    const q = buildIssueSearchQuery({
      repoFullName: "acme/web",
      includeClosed: false,
      labels: ["bug", "good first issue"],
    });
    expect(q).toBe(
      'repo:acme/web type:issue state:open label:bug label:"good first issue"',
    );
  });
});

/**
 * Sweep #22 — Convex redacts a non-ConvexError throw to "Server Error" in
 * production. These two actions are driven straight from the integration
 * wizard's repo-picker and preview step, and every failure an admin can act on
 * (App credentials unset, installation revoked) was a plain `Error` — so the
 * actionable sentence the code already wrote never reached the toast.
 *
 * The seam is the missing-credentials branch: it is reached before any network
 * call, so it needs no HTTP stubbing, and it is the exact failure a deployment
 * without GITHUB_APP_ID hits on the wizard's first step.
 */
describe("integrations/github/wizardActions — caller-actionable errors", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  });
  afterEach(() => {
    if (savedAppId !== undefined) process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  async function setupInstallation(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
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
    return { workspaceId, asUser };
  }

  it("reports missing App credentials as a ConvexError from listInstallationRepos", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupInstallation(t);

    await expect(
      asUser.action(api.integrations.github.wizardActions.listInstallationRepos, {
        workspaceId,
        externalAccountId: "install-999",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("reports missing App credentials as a ConvexError from previewImportCount", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupInstallation(t);

    await expect(
      asUser.action(api.integrations.github.wizardActions.previewImportCount, {
        workspaceId,
        externalAccountId: "install-999",
        repoFullName: "acme/web",
        includeClosed: false,
        labels: [],
      }),
    ).rejects.toThrow(ConvexError);
  });
});
