import { describe, expect, it } from "vitest";
import { isSyncDescriptionButtonVisible } from "../convex/integrations/core/description";

describe("integrations/core/description.isSyncDescriptionButtonVisible", () => {
  it("hidden when there is no linked GitHub issue", () => {
    expect(
      isSyncDescriptionButtonVisible({
        hasLinkedIssue: false,
        isDescriptionEmpty: false,
      }),
    ).toBe(false);
  });

  it("hidden when description is empty", () => {
    expect(
      isSyncDescriptionButtonVisible({
        hasLinkedIssue: true,
        isDescriptionEmpty: true,
      }),
    ).toBe(false);
  });

  it("visible when the task has a linked issue AND a non-empty description", () => {
    expect(
      isSyncDescriptionButtonVisible({
        hasLinkedIssue: true,
        isDescriptionEmpty: false,
      }),
    ).toBe(true);
  });
});
