import { describe, expect, it } from "vitest";
import { localGraphKey, mergeLocalGraphs, type LocalGraphData } from "./local-graph";

const star = (center: string, ...neighbours: string[]): LocalGraphData => ({
  nodes: [center, ...neighbours].map((id) => ({ id, type: "document", name: id })),
  links: neighbours.map((id) => ({ source: center, target: id, edgeType: "embeds" })),
});

describe("mergeLocalGraphs", () => {
  it("returns the base unchanged with no expansions", () => {
    const base = star("t", "a", "b");
    expect(mergeLocalGraphs(base, [])).toEqual(base);
  });

  it("adds an expanded node's neighbours once", () => {
    const merged = mergeLocalGraphs(star("t", "a", "b"), [star("a", "t", "c")]);
    expect(merged.nodes.map((n) => n.id)).toEqual(["t", "a", "b", "c"]);
    expect(merged.links.map((l) => `${l.source}-${l.target}`)).toEqual(["t-a", "t-b", "a-c"]);
  });

  it("dedupes a link reported from both ends", () => {
    const merged = mergeLocalGraphs(star("t", "a"), [
      { nodes: star("a", "t").nodes, links: [{ source: "a", target: "t", edgeType: "embeds" }] },
    ]);
    expect(merged.links).toHaveLength(1);
  });
});

describe("localGraphKey", () => {
  it("is equal for equal content and differs when content changes", () => {
    expect(localGraphKey(star("t", "a"))).toBe(localGraphKey(star("t", "a")));
    expect(localGraphKey(star("t", "a"))).not.toBe(localGraphKey(star("t", "b")));
  });
});
