import { describe, it, expect } from "vitest";
import { tryGetChanges } from "./editor-changes";
import type { BlockChange } from "./editor-types";

const deletion = (id: string): BlockChange => ({
  block: { id, type: "diagram", props: {} },
  source: { type: "local" },
  type: "delete",
  prevBlock: undefined,
});

describe("tryGetChanges", () => {
  it("returns the changes when BlockNote can describe them", () => {
    const changes = [deletion("block-1")];
    expect(tryGetChanges(() => changes)).toBe(changes);
  });

  it("returns null instead of rethrowing when a pending block has no id", () => {
    // Regression: BlockNote >=0.53 throws this from `filterTransaction` for
    // nodes a split (Enter) or paste just created, killing the transaction.
    expect(
      tryGetChanges(() => {
        throw new Error("Node blockContainer does not have an ID");
      }),
    ).toBeNull();
  });
});
