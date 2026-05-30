import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { pickRepoForTags } from "./useGithubIssueDraft";
import type { ActiveRepoLink } from "./useGithubIssueEligibility";

// Minimal link fixtures — pickRepoForTags only reads `_id` and `autoSelectTags`.
const link = (id: string, tags?: string[]): ActiveRepoLink =>
  ({
    _id: id as Id<"projectIntegrationLinks">,
    autoSelectTags: tags,
  }) as ActiveRepoLink;

const id = (s: string) => s as Id<"projectIntegrationLinks">;

describe("pickRepoForTags", () => {
  const repoA = link("repoA", ["backend", "api"]);
  const repoB = link("repoB", ["ui"]);
  const repoC = link("repoC"); // no rule

  it("preselects the repo on an unambiguous single-repo match", () => {
    expect(pickRepoForTags([repoA, repoB, repoC], ["backend"])).toBe(
      id("repoA"),
    );
  });

  it("returns null when no tag matches any repo's rule", () => {
    expect(pickRepoForTags([repoA, repoB, repoC], ["chore"])).toBeNull();
  });

  it("returns null when tags point at different repos (conflict)", () => {
    expect(pickRepoForTags([repoA, repoB, repoC], ["backend", "ui"])).toBeNull();
  });

  it("preselects when several tags all point at the same repo (agreement)", () => {
    expect(pickRepoForTags([repoA, repoB], ["backend", "api"])).toBe(
      id("repoA"),
    );
  });

  it("matches case-insensitively and tolerates surrounding whitespace", () => {
    expect(pickRepoForTags([repoA, repoB], ["  BACKEND "])).toBe(id("repoA"));
  });

  it("returns null for an empty label list", () => {
    expect(pickRepoForTags([repoA, repoB], [])).toBeNull();
  });
});
