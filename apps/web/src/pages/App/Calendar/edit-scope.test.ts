import { describe, it, expect } from "vitest";

import { defaultScope, resetNotice, scopeChoices } from "./edit-scope";

/** The scopes an edit may actually be applied to, in offer order. */
const offered = (...args: Parameters<typeof scopeChoices>) =>
  scopeChoices(...args)
    .filter((c) => c.disabledReason === null)
    .map((c) => c.scope);

describe("which scopes an edit can be applied to", () => {
  it("offers all three for a content edit", () => {
    expect(offered({ kind: "content" })).toEqual(["occurrence", "following", "series"]);
  });

  it("drops the single-occurrence scope for a rule edit", () => {
    // A recurrence, an anchor or a duration belongs to the pattern; moving one
    // occurrence is a drag on the calendar, not a change to the rule.
    expect(offered({ kind: "rule" })).toEqual(["following", "series"]);
  });

  it("leaves a series edit with nothing narrower than the whole series", () => {
    // Tags and the roster are filed under the series and nowhere else, so an
    // occurrence has no copy of either for a narrower scope to change.
    expect(offered({ kind: "series" })).toEqual(["series"]);
  });

  it("still lists the scopes it cannot use, saying why", () => {
    // Withheld options read as options that never existed. The reason — "tags
    // and invitations belong to the whole series" — is the whole point of
    // asking a question with one answer.
    const choices = scopeChoices({ kind: "series" });
    expect(choices.map((c) => c.scope)).toEqual(["occurrence", "following", "series"]);
    expect(choices[0].disabledReason).toMatch(/whole series/);
    expect(choices[1].disabledReason).toMatch(/whole series/);
  });

  it("narrows to the whole series when there is no occurrence to stand on", () => {
    // The surface a bare link lands on once the rule has run out: same fields,
    // no date under them, so nothing narrower has a coordinate to hang off.
    expect(offered({ kind: "content", hasOccurrence: false })).toEqual(["series"]);
  });

  it("starts the question on the narrowest scope still on offer", () => {
    expect(defaultScope(scopeChoices({ kind: "content" }))).toBe("occurrence");
    expect(defaultScope(scopeChoices({ kind: "rule" }))).toBe("following");
    expect(defaultScope(scopeChoices({ kind: "series" }))).toBe("series");
  });
});

describe("the confirmation before a rule edit", () => {
  const counts = { series: 3, following: 1 };

  it("states how many customised occurrences the whole-series edit will reset", () => {
    expect(resetNotice({ kind: "rule", scope: "series", overrideCounts: counts })).toBe(
      "3 edited occurrences will be reset to the series pattern.",
    );
  });

  it("counts only the ones a split reaches, in the singular", () => {
    expect(resetNotice({ kind: "rule", scope: "following", overrideCounts: counts })).toBe(
      "1 edited occurrence will be reset to the series pattern.",
    );
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
    expect(resetNotice({ kind: "content", scope: "series", overrideCounts: counts })).toBeNull();
    expect(
      resetNotice({
        kind: "content",
        scope: "following",
        overrideCounts: counts,
      }),
    ).toBeNull();
  });
});
