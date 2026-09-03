import { describe, expect, it } from "vitest";
import { expandPriorityPattern } from "./priority-label-pattern";

/**
 * "Fill from pattern" on the priority-labels editor (ticket 07): one input
 * like `priority/{priority}` expands into the four per-priority fields
 * without saving anything.
 */
describe("expandPriorityPattern", () => {
  it("substitutes each priority for the placeholder", () => {
    expect(expandPriorityPattern("priority/{priority}")).toEqual({
      urgent: "priority/urgent",
      high: "priority/high",
      medium: "priority/medium",
      low: "priority/low",
    });
  });

  it("substitutes every occurrence and tolerates surrounding whitespace", () => {
    expect(expandPriorityPattern("  {priority}::{priority} ")).toEqual({
      urgent: "urgent::urgent",
      high: "high::high",
      medium: "medium::medium",
      low: "low::low",
    });
  });

  it("returns null for a pattern with no placeholder, since it could only produce four identical labels", () => {
    expect(expandPriorityPattern("priority")).toBeNull();
    expect(expandPriorityPattern("")).toBeNull();
  });
});
