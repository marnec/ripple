/**
 * The local graph's hover caption sits under its box; the page reserves this
 * strip before the canvas's lazy chunk arrives, so nothing reflows.
 */
export const LOCAL_GRAPH_CAPTION_HEIGHT = 24;

export type LocalGraphNode = { id: string; type: string; name?: string; groupId?: string };
export type LocalGraphLink = { source: string; target: string; edgeType: string };
export type LocalGraphData = { nodes: LocalGraphNode[]; links: LocalGraphLink[] };

/**
 * Union a local graph with the local graphs of nodes expanded from it. Nodes
 * dedupe by id (first seen wins); links dedupe by their unordered pair, since
 * two stars that share a neighbour both report the edge between them, once
 * from each end.
 */
export function mergeLocalGraphs(base: LocalGraphData, expansions: LocalGraphData[]): LocalGraphData {
  const nodes = new Map<string, LocalGraphNode>();
  const links = new Map<string, LocalGraphLink>();
  for (const graph of [base, ...expansions]) {
    for (const node of graph.nodes) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    }
    for (const link of graph.links) {
      const key = [link.source, link.target].sort().join("|");
      if (!links.has(key)) links.set(key, link);
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

/**
 * A graph's content as a string: equal for equal graphs whatever their
 * identity, so a re-delivered payload does not rebuild the simulation.
 */
export function localGraphKey(graph: LocalGraphData): string {
  return JSON.stringify([
    graph.nodes.map((n) => [n.id, n.type, n.name, n.groupId]),
    graph.links.map((l) => [l.source, l.target, l.edgeType]),
  ]);
}
