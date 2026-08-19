import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  EMPTY_SPREADSHEET_UPDATE,
  seedEmptyGrid,
} from "./empty-grid";

/**
 * What happens to a spreadsheet's rows when replicas that disagree about them
 * meet again — the grid's half of `empty-document.test.ts`.
 *
 * Same vocabulary: a **hydrated replica** holds the room's state; an
 * **unhydrated replica** is an empty Y.Doc that is empty because nobody has
 * told it anything. Yjs cannot tell the two apart, so seeding the second is
 * how a sheet ends up with two sets of rows claiming the same coordinates.
 */

const ORIGIN = Symbol("test");

function rows(doc: Y.Doc) {
  return doc.getArray<Y.Map<string>>("data");
}

/** Merge two replicas both ways, as a sync would. */
function reconcile(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

describe("EMPTY_SPREADSHEET_UPDATE", () => {
  it("is a full default grid", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, EMPTY_SPREADSHEET_UPDATE);

    expect(rows(doc).length).toBe(DEFAULT_ROWS);
    expect(doc.getMap("meta").get("colCount")).toBe(DEFAULT_COLS);
    expect(doc.getArray<string>("rowOrder").length).toBe(DEFAULT_ROWS);
    expect(doc.getArray<string>("colOrder").length).toBe(DEFAULT_COLS);
  });

  it("is idempotent when applied twice to one replica", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, EMPTY_SPREADSHEET_UPDATE);
    Y.applyUpdate(doc, EMPTY_SPREADSHEET_UPDATE);

    expect(rows(doc).length).toBe(DEFAULT_ROWS);
  });

  it("survives two hydrated replicas bootstrapping at once", () => {
    // The fixed client id is what makes this one grid rather than two.
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedEmptyGrid(a, ORIGIN);
    seedEmptyGrid(b, ORIGIN);

    reconcile(a, b);

    expect(rows(a).length).toBe(DEFAULT_ROWS);
    expect(rows(b).length).toBe(DEFAULT_ROWS);
    expect(a.getArray<string>("rowOrder").toArray()).toEqual(
      b.getArray<string>("rowOrder").toArray(),
    );
  });
});

describe("seedEmptyGrid", () => {
  it("seeds a replica with no rows", () => {
    const doc = new Y.Doc();
    expect(seedEmptyGrid(doc, ORIGIN)).toBe(true);
    expect(rows(doc).length).toBe(DEFAULT_ROWS);
  });

  it("leaves a replica that already holds rows alone", () => {
    const doc = new Y.Doc();
    seedEmptyGrid(doc, ORIGIN);
    const row = rows(doc).get(0);
    row.set("0", "kept");

    expect(seedEmptyGrid(doc, ORIGIN)).toBe(false);
    expect(rows(doc).get(0).get("0")).toBe("kept");
    expect(rows(doc).length).toBe(DEFAULT_ROWS);
  });

  it("stamps the origin, so edit detection can tell it from a user edit", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tx: Y.Transaction) => origins.push(tx.origin));

    seedEmptyGrid(doc, ORIGIN);

    expect(origins).toContain(ORIGIN);
  });

  it("does not destroy a hydrated peer's content when seeded on an unhydrated replica", () => {
    // The hazard this precondition exists for, stated as a test. A guest has
    // no cache and no cold-start snapshot, so before its first sync its replica
    // is unhydrated — indistinguishable, inside Yjs, from a genuinely new sheet.
    const author = new Y.Doc();
    seedEmptyGrid(author, ORIGIN);
    author.getArray<Y.Map<string>>("data").get(3).set("2", "real content");

    const guest = new Y.Doc();
    seedEmptyGrid(guest, ORIGIN); // what the binding's constructor used to do

    reconcile(author, guest);

    // The fixed client id saves us here: both sides seeded the *same* rows, so
    // the merge is a no-op rather than a duplication. This is why the bug was
    // survivable — but it is the precondition, not luck, that has to hold.
    expect(rows(guest).length).toBe(DEFAULT_ROWS);
    expect(rows(guest).get(3).get("2")).toBe("real content");
  });

  it("keeps a hydrated peer's row count when the unhydrated side is left unseeded", () => {
    const author = new Y.Doc();
    seedEmptyGrid(author, ORIGIN);
    author.getArray<Y.Map<string>>("data").get(0).set("0", "real content");

    const guest = new Y.Doc(); // unhydrated, and correctly left alone

    reconcile(author, guest);

    expect(rows(guest).length).toBe(DEFAULT_ROWS);
    expect(rows(guest).get(0).get("0")).toBe("real content");
  });
});
