import { describe, expect, it } from "vitest";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Characterization test for the `fractional-indexing` key format.
 *
 * These strings are not derived values — they are *stored*, in `tasks.position`
 * and in each Excalidraw element's `pos` inside the Yjs doc, and they are only
 * ever compared against each other. So the library is not a normal dependency:
 * a version that generates a different-but-internally-consistent format would
 * pass every behavioural test in this repo while silently interleaving new rows
 * incorrectly against every row already in the database. There is no error, no
 * crash — just a board whose cards drift into the wrong order.
 *
 * That is exactly the risk v4.0.0 introduced. It made the alphabet
 * configurable, and passing `digits` explicitly (even the same BASE_62_DIGITS
 * v3 used by default) now switches keys to a "self-headed" form — so
 * `generateKeyBetween(a, b, BASE_62_DIGITS)` produces a *different* format than
 * v3's default. Our call sites all omit `digits`, which keeps the classic
 * A-Z/a-z head form; these goldens pin that.
 *
 * If a future bump fails this file, do not update the expectations. The keys in
 * the database cannot be regenerated, so a format change needs a migration, not
 * a new golden.
 *
 * The values below were captured from 3.2.0 and verified identical under 4.0.0.
 */
describe("fractional-indexing key format", () => {
  it("appends with the classic a-z head form", () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 8; i++) {
      last = generateKeyBetween(last, null);
      keys.push(last);
    }
    expect(keys).toEqual(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
  });

  it("prepends into the A-Z head range", () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 6; i++) {
      first = generateKeyBetween(null, first);
      keys.push(first);
    }
    expect(keys).toEqual(["a0", "Zz", "Zy", "Zx", "Zw", "Zv"]);
  });

  it("subdivides between two neighbours", () => {
    const keys: string[] = [];
    let hi = "a1";
    for (let i = 0; i < 6; i++) {
      hi = generateKeyBetween("a0", hi);
      keys.push(hi);
    }
    expect(keys).toEqual(["a0V", "a0G", "a08", "a04", "a02", "a01"]);
  });

  it("generates n keys in the same format", () => {
    expect(generateNKeysBetween(null, null, 5)).toEqual([
      "a0",
      "a1",
      "a2",
      "a3",
      "a4",
    ]);
    expect(generateNKeysBetween("a0", "a1", 4)).toEqual([
      "a08",
      "a0G",
      "a0V",
      "a0l",
    ]);
  });

  it("keeps generated keys in ordinal sort order", () => {
    // The property every call site depends on: plain `<`/`>` on the raw string
    // must agree with insertion order. `localeCompare` does NOT — see the
    // comments in `tasks.ts` and `KanbanBoard.tsx`.
    const keys = generateNKeysBetween(null, null, 200);
    const sorted = [...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(sorted).toEqual(keys);
  });

  it("still rejects two identical neighbours", () => {
    // v4 relaxed reversed bounds (a > b now swaps instead of throwing), but an
    // empty interval remains an error. `KanbanBoard` can only reach this if two
    // tasks somehow share a position, so it must stay loud.
    expect(() => generateKeyBetween("a1", "a1")).toThrow();
  });
});
