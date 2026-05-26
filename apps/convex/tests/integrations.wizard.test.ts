import { describe, expect, it } from "vitest";
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
