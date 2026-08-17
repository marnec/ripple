import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { forceX, forceY } from "d3-force-3d";
import type { Id } from "@convex/_generated/dataModel";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from "react-force-graph-2d";
import { getNodeColor, getNodeSize } from "./graphConstants";

type GraphNode = NodeObject & {
  id: string;
  type: string;
  name?: string;
  groupId?: string;
};

type GraphLink = LinkObject & {
  source: string | GraphNode;
  target: string | GraphNode;
  edgeType: string;
};

function getNodeRoute(node: GraphNode, workspaceId: string): string | null {
  switch (node.type) {
    case "document":
      return `/workspaces/${workspaceId}/documents/${node.id}`;
    case "diagram":
      return `/workspaces/${workspaceId}/diagrams/${node.id}`;
    case "spreadsheet":
      return `/workspaces/${workspaceId}/spreadsheets/${node.id}`;
    case "channel":
      return `/workspaces/${workspaceId}/channels/${node.id}`;
    default:
      return null;
  }
}

type GraphData = {
  nodes: Array<{ id: string; type: string; name?: string; groupId?: string }>;
  links: Array<{ source: string; target: string; edgeType: string }>;
};

type BuiltGraph = { nodes: GraphNode[]; links: GraphLink[] };

// Identity marker for "no payload has landed yet", so the all-hidden message can
// tell an empty graph apart from a graph that simply has not loaded.
const EMPTY_GRAPH: BuiltGraph = { nodes: [], links: [] };

// How far a newly-appeared node is dropped from the neighbour it anchors to.
const SEED_SPREAD = 20;

function addNeighbour(map: Map<string, string[]>, from: string, to: string) {
  const existing = map.get(from);
  if (existing) existing.push(to);
  else map.set(from, [to]);
}

/**
 * Turn a payload + the current visibility filter into the arrays force-graph
 * draws, reusing node objects from `registry`.
 *
 * force-graph mutates `x`/`y`/`vx`/`vy` straight onto the node objects it is
 * handed, so the layout only survives a data change if the same object comes
 * back for a given id. Every payload — a live-query update, an `includeTags`
 * refetch — carries brand-new objects, which is why rebuilding from it directly
 * threw the whole simulation away.
 */
function buildVisibleGraph(
  source: GraphData,
  hiddenTypes: Set<string>,
  registry: Map<string, GraphNode>,
): BuiltGraph & { signature: string } {
  const visible: GraphNode[] = [];
  const visibleIds = new Set<string>();
  const payloadIds = new Set<string>();

  for (const raw of source.nodes) {
    payloadIds.add(raw.id);
    let node = registry.get(raw.id);
    if (node) {
      // Refresh the display fields in place — never replace the object.
      node.type = raw.type;
      node.name = raw.name;
      node.groupId = raw.groupId;
    } else {
      node = { id: raw.id, type: raw.type, name: raw.name, groupId: raw.groupId };
      registry.set(raw.id, node);
    }
    if (!hiddenTypes.has(raw.type)) {
      visible.push(node);
      visibleIds.add(raw.id);
    }
  }

  // Forget nodes that left the payload, except hidden ones: a hidden type can be
  // missing from the payload entirely (`includeTags` follows the tag toggle), and
  // we want its old positions back when it is shown again rather than a reshuffle.
  for (const [id, node] of registry) {
    if (!payloadIds.has(id) && !hiddenTypes.has(node.type)) registry.delete(id);
  }

  const links: GraphLink[] = [];
  for (const raw of source.links) {
    if (visibleIds.has(raw.source) && visibleIds.has(raw.target)) {
      links.push({ source: raw.source, target: raw.target, edgeType: raw.edgeType });
    }
  }

  // Synthetic "contains" links (project→task, channel→message)
  const seen = new Set<string>();
  for (const node of visible) {
    if (node.groupId && visibleIds.has(node.groupId)) {
      const key = `${node.groupId}→${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: node.groupId, target: node.id, edgeType: "contains" });
    }
  }

  // Drop nodes that have never been laid out next to something they attach to, so
  // showing a type slides its nodes in beside their neighbours instead of having
  // d3 spiral them out from the origin and drag the rest of the graph along.
  const unplaced = visible.filter((n) => n.x === undefined);
  if (unplaced.length > 0 && unplaced.length < visible.length) {
    const neighbours = new Map<string, string[]>();
    for (const link of links) {
      const from = link.source as string;
      const to = link.target as string;
      addNeighbour(neighbours, from, to);
      addNeighbour(neighbours, to, from);
    }
    for (const node of unplaced) {
      const anchors = node.groupId ? [node.groupId, ...(neighbours.get(node.id) ?? [])] : (neighbours.get(node.id) ?? []);
      for (const anchorId of anchors) {
        const anchor = registry.get(anchorId);
        if (anchor?.x !== undefined && anchor.y !== undefined) {
          node.x = anchor.x + (Math.random() - 0.5) * SEED_SPREAD;
          node.y = anchor.y + (Math.random() - 0.5) * SEED_SPREAD;
          break;
        }
      }
    }
  }

  const signature = `${visible.map((n) => n.id).join(",")}|${links
    .map((l) => `${l.source as string}>${l.target as string}:${l.edgeType}`)
    .join(",")}`;

  return { nodes: visible, links, signature };
}

type WorkspaceGraphProps = {
  workspaceId: Id<"workspaces">;
  graph: GraphData | undefined;
  width: number;
  height: number;
  hiddenTypes: Set<string>;
  highlightedType?: string | null;
};

export function WorkspaceGraph({ workspaceId, graph, width, height, hiddenTypes, highlightedType }: WorkspaceGraphProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
  const hoveredNodeRef = useRef<string | null>(null);
  const highlightedTypeRef = useRef<string | null>(null);
  useEffect(() => {
    highlightedTypeRef.current = highlightedType ?? null;
  }, [highlightedType]);
  const nodesRef = useRef<GraphNode[]>([]);

  const [graphData, setGraphData] = useState<BuiltGraph>(EMPTY_GRAPH);

  // Everything the graph needs to carry across payloads. Only ever touched from
  // effects, never during render.
  const carryRef = useRef<{
    registry: Map<string, GraphNode>;
    workspaceId: string;
    source: GraphData | undefined;
    signature: string | undefined;
  }>({ registry: new Map<string, GraphNode>(), workspaceId, source: undefined, signature: undefined });

  useEffect(() => {
    const carry = carryRef.current;
    if (carry.workspaceId !== workspaceId) {
      carry.workspaceId = workspaceId;
      carry.registry.clear();
      carry.source = undefined;
      carry.signature = undefined;
      setGraphData(EMPTY_GRAPH);
    }

    // Toggling tags flips the query's `includeTags` arg, so `graph` reads
    // undefined until the new payload lands. Keep drawing the last one — going
    // blank here is what made the canvas blink out on every tag toggle.
    const source = graph ?? carry.source;
    if (!source) return;
    carry.source = source;

    const built = buildVisibleGraph(source, hiddenTypes, carry.registry);
    // Same nodes, same links: hand back the exact same object so force-graph
    // never sees a data change. This is the common case for the tag toggle
    // (tags were already hidden) and for payload updates that only touch a
    // field we mutate in place, and it keeps the simulation completely still.
    if (built.signature === carry.signature) return;
    carry.signature = built.signature;
    setGraphData({ nodes: built.nodes, links: built.links });
  }, [workspaceId, graph, hiddenTypes]);

  // Snapshot of the camera taken before force-graph digests new data (it does so
  // on a 1ms debounce, i.e. after our effects), restored on the next tick.
  const pendingViewportRef = useRef<{ k: number; x: number; y: number } | null>(null);
  const hasLaidOutRef = useRef(false);

  // Clamp node positions on every tick
  const handleEngineTick = () => {
    const pending = pendingViewportRef.current;
    if (pending) {
      // force-graph re-derives the default zoom from the node count whenever the
      // data changes, so adding or removing nodes yanks the camera. Put it back
      // on the first tick after the update (the auto-zoom lands in the same
      // digest, before any tick). Restoring also leaves the transform out of
      // sync with the library's `lastSetZoom`, which retires the auto-zoom for
      // good.
      pendingViewportRef.current = null;
      fgRef.current?.zoom(pending.k);
      fgRef.current?.centerAt(pending.x, pending.y);
    }
    if (width === 0 || height === 0) return;
    const padding = 50;
    const halfW = width / 2 - padding;
    const halfH = height / 2 - padding;
    for (const node of nodesRef.current) {
      if (node.x !== undefined) {
        if (node.x < -halfW) { node.x = -halfW; if (node.vx !== undefined) node.vx = 0; }
        if (node.x > halfW) { node.x = halfW; if (node.vx !== undefined) node.vx = 0; }
      }
      if (node.y !== undefined) {
        if (node.y < -halfH) { node.y = -halfH; if (node.vy !== undefined) node.vy = 0; }
        if (node.y > halfH) { node.y = halfH; if (node.vy !== undefined) node.vy = 0; }
      }
    }
  };

  const handleNodeClick = (node: GraphNode) => {
      const route = getNodeRoute(node, workspaceId);
      if (route) void navigate(route);
    };

  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleNodeHover = (node: GraphNode | null) => {
    hoveredNodeRef.current = node?.id ?? null;
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = node && getNodeRoute(node, workspaceId) ? "pointer" : "default";
    }
  };

  const paintNode = (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      const size = getNodeSize(node.type);
      const color = getNodeColor(node.type, isDark);
      const isHovered = hoveredNodeRef.current === node.id;
      const ht = highlightedTypeRef.current;
      const isTypeHighlighted = ht === node.type
        || (ht === "channel" && node.type === "message");
      const isHighlighted = isHovered || isTypeHighlighted;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (isHighlighted) {
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      // White separation ring (example: circle stroke #fff, stroke-width 1.5 at
      // r=5 → ~0.3·r). On dark theme stroke with the background instead of white
      // so the ring reads as separation rather than a bright halo.
      ctx.lineWidth = size * 0.3;
      ctx.strokeStyle = isDark ? "#0a0a0a" : "#ffffff";
      ctx.stroke();

      // Show label when zoomed in or highlighted
      const zoom = ctx.getTransform().a;
      const showLabel = zoom > 3 || isHighlighted;
      if (showLabel && node.name) {
        const label = node.name.length > 20 ? node.name.slice(0, 18) + "…" : node.name;
        ctx.font = `${isHighlighted ? "bold " : ""}3px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
        ctx.fillText(label, x, y + size + 2);
      }
    };

  useEffect(() => {
    nodesRef.current = graphData.nodes;
  }, [graphData]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    if (!hasLaidOutRef.current) {
      // Let force-graph pick the opening zoom for the first payload.
      hasLaidOutRef.current = true;
      return;
    }
    const center = fg.centerAt();
    pendingViewportRef.current = { k: fg.zoom(), x: center.x, y: center.y };
  }, [graphData]);

  // Disjoint force-directed layout (https://observablehq.com/@d3/disjoint-force-directed-graph):
  // replace the single centering force with independent x/y positioning forces
  // so each disconnected cluster gravitates toward the centre on its own axis
  // instead of unconnected components drifting off to infinity. forceManyBody
  // (charge) and forceLink are left at react-force-graph's defaults, matching
  // the example's d3.forceManyBody()/d3.forceLink(links).id(d => d.id).
  //
  // Set once: forces live on the simulation object, which survives every data
  // change (force-graph only re-feeds nodes/links and re-heats alpha to 1).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("center", null);
    fg.d3Force("x", forceX());
    fg.d3Force("y", forceY());
  }, []);

  // The canvas stays mounted through loading and through an all-hidden filter —
  // unmounting it would destroy the simulation and every node position with it.
  const allHidden = graphData !== EMPTY_GRAPH && graphData.nodes.length === 0;

  return (
    <div ref={wrapperRef} className="relative overflow-hidden" style={{ width, height }}>
      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
          const size = getNodeSize(node.type);
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onEngineTick={handleEngineTick}
        linkColor={(link: GraphLink) => {
          // Example links: stroke #999, stroke-opacity 0.6. #999 reads on both
          // themes; the synthetic "contains" links stay fainter to set them apart.
          const et = typeof link.edgeType === "string" ? link.edgeType : "";
          if (et === "contains") return "rgba(153,153,153,0.3)";
          return "rgba(153,153,153,0.6)";
        }}
        linkWidth={(link: GraphLink) => {
          const et = typeof link.edgeType === "string" ? link.edgeType : "";
          return et === "contains" ? 0.5 : 1;
        }}
        linkLineDash={(link: GraphLink) => {
          const et = typeof link.edgeType === "string" ? link.edgeType : "";
          return et === "contains" ? [2, 2] : null;
        }}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={200}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.6}
        autoPauseRedraw={false}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />
      {allHidden && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          All node types are hidden. Click a type in the legend to show it.
        </div>
      )}
    </div>
  );
}
