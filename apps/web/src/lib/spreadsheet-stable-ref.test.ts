import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { a1ToStable, serializeStableRef } from "@ripple/shared/stableRef";
import { resolveStableRefLocally } from "./spreadsheet-stable-ref";

/**
 * The client-side answer has to be the *same* answer the server action gives,
 * because an embed inserted through one path is read back through the other.
 * Both call `a1ToStable` against the room's order arrays; these pin that the
 * replica is read the way the snapshot is, and that a replica which cannot
 * answer says so instead of inventing an identity.
 */

function sheet(rowOrder: string[], colOrder: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.getArray<string>("rowOrder").insert(0, rowOrder);
  doc.getArray<string>("colOrder").insert(0, colOrder);
  return doc;
}

describe("resolveStableRefLocally", () => {
  it("resolves a cell to the identity the server would compute", () => {
    const rowOrder = ["r1", "r2", "r3"];
    const colOrder = ["c1", "c2"];

    expect(resolveStableRefLocally(sheet(rowOrder, colOrder), "B2")).toBe(
      serializeStableRef(a1ToStable("B2", rowOrder, colOrder)!),
    );
  });

  it("resolves a range", () => {
    const rowOrder = ["r1", "r2", "r3"];
    const colOrder = ["c1", "c2", "c3"];

    expect(resolveStableRefLocally(sheet(rowOrder, colOrder), "a1:b2")).toBe(
      serializeStableRef(a1ToStable("A1:B2", rowOrder, colOrder)!),
    );
  });

  it("declines a sheet whose replica holds no order arrays", () => {
    // An unhydrated replica looks exactly like this, so it must not answer.
    expect(resolveStableRefLocally(new Y.Doc(), "A1")).toBeNull();
  });

  it("declines a reference past the end of the grid", () => {
    expect(resolveStableRefLocally(sheet(["r1"], ["c1"]), "C9")).toBeNull();
  });
});
