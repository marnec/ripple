import { describe, it, expect } from "vitest";

import { resetNotice, scopeChoices } from "./edit-scope";

describe("which scopes an edit can be applied to", () => {
  it("offers all three for a content edit", () => {
    expect(scopeChoices("content").map((c) => c.scope)).toEqual([
      "occurrence",
      "following",
      "series",
    ]);
  });

  it("drops the single-occurrence scope for a rule edit", () => {
    // A recurrence, an anchor or a duration belongs to the pattern; moving one
    // occurrence is a drag on the calendar, not a change to the rule.
    expect(scopeChoices("rule").map((c) => c.scope)).toEqual([
      "following",
      "series",
    ]);
  });
});

describe("the confirmation before a rule edit", () => {
  const counts = { series: 3, following: 1 };

  it("states how many customised occurrences the whole-series edit will reset", () => {
    expect(
      resetNotice({ kind: "rule", scope: "series", overrideCounts: counts }),
    ).toBe("3 edited occurrences will be reset to the series pattern.");
  });

  it("counts only the ones a split reaches, in the singular", () => {
    expect(
      resetNotice({ kind: "rule", scope: "following", overrideCounts: counts }),
    ).toBe("1 edited occurrence will be reset to the series pattern.");
  });

  it("stays quiet when nothing in reach has been customised", () => {
    expect(
      resetNotice({
        kind: "rule",
        scope: "series",
        overrideCounts: { series: 0, following: 0 },
      }),
    ).toBeNull();
  });

  it("stays quiet for a content edit, which loses nothing", () => {
    // A content edit leaves overrides standing under "all", and a split
    // re-files the later ones onto the continuation. Neither is a loss.
    expect(
      resetNotice({ kind: "content", scope: "series", overrideCounts: counts }),
    ).toBeNull();
    expect(
      resetNotice({
        kind: "content",
        scope: "following",
        overrideCounts: counts,
      }),
    ).toBeNull();
  });
});
