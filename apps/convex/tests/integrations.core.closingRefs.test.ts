import { describe, expect, it } from "vitest";
import {
  collectReferencedIssueNumbers,
  parseBranchIssueNumber,
  parseClosingIssueNumbers,
} from "../convex/integrations/core/closingRefs";

describe("parseClosingIssueNumbers", () => {
  it("matches each closing keyword form, case-insensitively", () => {
    for (const kw of [
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
      "CLOSES",
      "Fixes",
    ]) {
      expect(parseClosingIssueNumbers(`${kw} #27`)).toEqual([27]);
    }
  });

  it("handles the colon form and dedupes across title+body", () => {
    expect(parseClosingIssueNumbers("fixes: #4")).toEqual([4]);
    expect(
      parseClosingIssueNumbers("Closes #2 and resolves #3, also closes #2"),
    ).toEqual([2, 3]);
  });

  it("ignores bare mentions and empty input", () => {
    expect(parseClosingIssueNumbers("see #27 for context")).toEqual([]);
    expect(parseClosingIssueNumbers("closes#27")).toEqual([]); // needs a space
    expect(parseClosingIssueNumbers(null)).toEqual([]);
    expect(parseClosingIssueNumbers(undefined)).toEqual([]);
  });
});

describe("parseBranchIssueNumber", () => {
  it("extracts the leading issue number from the convention", () => {
    expect(parseBranchIssueNumber("27-fix-login")).toBe(27);
    expect(parseBranchIssueNumber("4")).toBe(4);
    expect(parseBranchIssueNumber("marco/12-thing")).toBeNull(); // not leading
    expect(parseBranchIssueNumber("fix-27")).toBeNull();
    expect(parseBranchIssueNumber("release-2024")).toBeNull();
    expect(parseBranchIssueNumber(null)).toBeNull();
  });
});

describe("collectReferencedIssueNumbers", () => {
  it("returns closing-keyword numbers from text when no branch ref", () => {
    expect(
      collectReferencedIssueNumbers("Closes #2 and fixes #3", null),
    ).toEqual([2, 3]);
  });

  it("adds the leading branch issue number to the keyword numbers", () => {
    expect(
      collectReferencedIssueNumbers("no keyword here", "42-some-work"),
    ).toEqual([42]);
  });

  it("unions branch number with text keywords, deduped", () => {
    expect(
      new Set(
        collectReferencedIssueNumbers("closes #42 and fixes #7", "42-some-work"),
      ),
    ).toEqual(new Set([42, 7]));
  });

  it("returns an empty array when neither text nor branch reference an issue", () => {
    expect(collectReferencedIssueNumbers("just a description", "main")).toEqual(
      [],
    );
  });
});
