import { describe, expect, it } from "vitest";
import {
  diffSet,
  normalizeLoginList,
} from "../convex/integrations/core/syncableSet";

/**
 * Pure unit tests for the set-mirror primitive that now backs BOTH the inbound
 * echo guard and the outbound diff for labels & assignees. The `changed` flag
 * is the load-bearing contract: inbound passes the raw (maybe-undefined) mirror
 * and skips when `!changed`; outbound passes `?? []` and pushes when `changed`.
 */

describe("diffSet", () => {
  it("computes order-insensitive add/remove against the prior set", () => {
    expect(diffSet(["a", "b"], ["b", "c"])).toEqual({
      add: ["a"],
      remove: ["c"],
      changed: true,
    });
  });

  it("equal sets (any order) are not changed → echo guard skips", () => {
    expect(diffSet(["bug", "good first issue"], ["good first issue", "bug"])).toEqual(
      { add: [], remove: [], changed: false },
    );
  });

  it("prev === undefined ('never synced') is always changed, even when next is empty", () => {
    // Matches the legacy inbound `sameLabelSet(next, undefined) === false`
    // (i.e. "not the same → apply").
    expect(diffSet([], undefined)).toEqual({ add: [], remove: [], changed: true });
    expect(diffSet(["bug"], undefined)).toEqual({
      add: ["bug"],
      remove: [],
      changed: true,
    });
  });

  it("prev === [] (outbound default) makes empty-vs-empty a no-op", () => {
    // Outbound callers pass `?? []` so a never-synced link with no desired
    // members enqueues nothing.
    expect(diffSet([], [])).toEqual({ add: [], remove: [], changed: false });
  });

  it("pure removal and pure addition each register as changed", () => {
    expect(diffSet([], ["x"])).toMatchObject({ add: [], remove: ["x"], changed: true });
    expect(diffSet(["x"], [])).toMatchObject({ add: ["x"], remove: [], changed: true });
  });
});

describe("normalizeLoginList", () => {
  it("lowercases, trims, dedupes, and preserves first-occurrence order", () => {
    expect(normalizeLoginList([" Octocat ", "octocat", "Alice"])).toEqual([
      "octocat",
      "alice",
    ]);
  });

  it("drops empty/whitespace-only entries", () => {
    expect(normalizeLoginList(["", "  ", "bob"])).toEqual(["bob"]);
  });

  it("closes the inbound/outbound casing divergence: same login in different cases compares equal", () => {
    // Inbound saw `Octocat` from a webhook; outbound mirrored `octocat` from a
    // stored identity. Canonicalizing both means the echo guard sees no change.
    const inbound = normalizeLoginList(["Octocat"]);
    const outbound = normalizeLoginList(["octocat"]);
    expect(diffSet(inbound, outbound).changed).toBe(false);
  });
});
