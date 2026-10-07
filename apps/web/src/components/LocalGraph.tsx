import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useQueries } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { getNodeColor } from "@/pages/App/Workspace/graphConstants";
import {
  LOCAL_GRAPH_CAPTION_HEIGHT,
  localGraphKey,
  mergeLocalGraphs,
  type LocalGraphData,
} from "@/lib/local-graph";

export type { LocalGraphData };

const NODE_RADIUS = 4;
const CENTER_RADIUS = 6;
/** Edge length, in pixels — the canvas is drawn 1:1, never zoomed to fit. */
const LINK_DISTANCE = 58;
/** Repulsion between nodes: enough to fan the neighbours out, no more. */
const CHARGE = -160;
/** Room kept between any node and the canvas edge. */
const EDGE_PADDING = 14;

/** A click's ripple, as in the logo: a quick burst of staggered rings. */
const BURST_RINGS = 2;
const BURST_GAP_SEC = 0.12;
/** How long each ring travels, and how far it gets. */
const BURST_RING_SEC = 0.6;
const BURST_RADIUS = 70;
/** Half-width of a ring's band, and where its dither has run out. */
const RING_BAND = 0.6;
const RING_EDGE = 2;
/** Peak dither density, then canvas alpha on top: almost invisible. */
const RING_STRENGTH = 0.45;
const RING_ALPHA = 0.3;

/** The logo's 8×8 ordered-dither matrix, as 0..1 thresholds. */
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39,
  13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

function bayer(x: number, y: number) {
  return BAYER8[(((y % 8) + 8) % 8) * 8 + (((x % 8) + 8) % 8)];
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type Bounds = { left: number; right: number; top: number; bottom: number };

/**
 * Stipple one ring of the given radius around (cx, cy) the way the logo's
 * shader does — one 1px cell per world unit, lit when its Bayer threshold is
 * under the band's brightness — dithered out from its band by `strength`. Walks only the ring's rows and spans, so it costs
 * its area rather than its bounding box, and skips cells outside `bounds`.
 */
function ditherRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  bounds: Bounds,
) {
  const ox = Math.round(cx);
  const oy = Math.round(cy);
  const rOut = radius + RING_EDGE;
  const rIn = Math.max(0, radius - RING_EDGE);
  const r = Math.ceil(rOut);
  ctx.beginPath();
  for (let dy = -r; dy <= r; dy++) {
    const y = oy + dy;
    if (y < bounds.top || y > bounds.bottom) continue;
    const outer2 = rOut * rOut - dy * dy;
    if (outer2 < 0) continue;
    const outer = Math.floor(Math.sqrt(outer2));
    const inner2 = rIn * rIn - dy * dy;
    const inner = inner2 > 0 ? Math.ceil(Math.sqrt(inner2)) : 0;
    for (let dx = -outer; dx <= outer; dx++) {
      // Jump the ring's hole.
      if (dx > -inner && dx < inner) dx = inner;
      const x = ox + dx;
      if (x < bounds.left || x > bounds.right) continue;
      const band = 1 - smoothstep(RING_BAND, RING_EDGE, Math.abs(Math.hypot(dx, dy) - radius));
      if (bayer(x, y) < band * strength) ctx.rect(x, y, 1, 1);
    }
  }
  ctx.fill();
}

type LocalNode = NodeObject & {
  id: string;
  type: string;
  name?: string;
  groupId?: string;
};

type LocalLink = LinkObject & { source: string | LocalNode; target: string | LocalNode; edgeType: string };

type Burst = { x: number; y: number; start: number; color: string };

function getNodeRoute(node: LocalNode, workspaceId: string): string | null {
  switch (node.type) {
    case "document":
      return `/workspaces/${workspaceId}/documents/${node.id}`;
    case "diagram":
      return `/workspaces/${workspaceId}/diagrams/${node.id}`;
    case "spreadsheet":
      return `/workspaces/${workspaceId}/spreadsheets/${node.id}`;
    case "channel":
      return `/workspaces/${workspaceId}/channels/${node.id}`;
    case "project":
      return `/workspaces/${workspaceId}/projects/${node.id}`;
    case "task":
      return node.groupId ? `/workspaces/${workspaceId}/projects/${node.groupId}/tasks/${node.id}` : null;
    case "calendarEvent":
    case "eventSeries":
      return `/workspaces/${workspaceId}/events/${node.id}`;
    default:
      return null;
  }
}

/**
 * Pull every node back inside the given bounds, in place. Called from the
 * simulation's tick, outside render: force-graph owns these objects' positions
 * and expects them mutated (it is how its own forces work).
 */
function clampNodes(
  nodes: LocalNode[],
  { halfW, top, bottom }: { halfW: number; top: number; bottom: number },
) {
  for (const node of nodes) {
    if (node.x !== undefined) node.x = Math.max(-halfW, Math.min(halfW, node.x));
    if (node.y !== undefined) node.y = Math.max(top, Math.min(bottom, node.y));
  }
}

/**
 * The **local graph** canvas (CONTEXT.md): one resource pinned at the centre
 * and its direct neighbours settling around it, from `graph.getLocalGraph`.
 *
 * Deliberately not `WorkspaceGraph`: that one is built for hundreds of
 * nodes. This is a star of a handful, grown by hand. Drawn 1:1 with short
 * links rather than zoomed to fit, so node and edge sizes are what the
 * constants say; a clamp keeps the star inside the canvas instead.
 *
 * Clicking a neighbour **expands** it: its own depth-1 neighbours (the same
 * query, live) join the graph, springing out of it, while the nodes already
 * there keep their places. Clicking it again collapses it — its query is
 * dropped, and with it every node only it brought, and every expansion made
 * from those. Projects do not expand: a project's neighbours are all of its
 * tasks. Ctrl/⌘-click opens a node. Each click sends one quick, faint,
 * dithered ripple out of the node, in the logo's idiom (none under
 * `prefers-reduced-motion`).
 *
 * Monochrome and unlabelled at rest: it sits beside a list that already
 * names every node; expanded nodes are drawn darker. Hovering a neighbour
 * gives it and its links the type colour and names it in a caption under
 * the box.
 */
export default function LocalGraph({
  centerId,
  workspaceId,
  graph,
  width,
  height,
}: {
  centerId: string;
  workspaceId: Id<"workspaces">;
  graph: LocalGraphData;
  width: number;
  height: number;
}) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fgRef = useRef<ForceGraphMethods<LocalNode, LocalLink>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Nodes expanded by a click, in click order; a new centre starts over.
  const [expanded, setExpanded] = useState<string[]>([]);
  // Where the latest expansion was clicked: its new nodes start there.
  const [seed, setSeed] = useState<{ x: number; y: number } | null>(null);
  const [expandedFor, setExpandedFor] = useState(centerId);
  if (expandedFor !== centerId) {
    setExpandedFor(centerId);
    setExpanded([]);
    setSeed(null);
  }

  const expansionResults = useQueries(
    Object.fromEntries(
      expanded.map((id) => [id, { query: api.graph.getLocalGraph, args: { resourceId: id, workspaceId } }]),
    ),
  );
  // Projects stay leaves: their neighbourhood is every task they hold.
  const canExpand = (node: LocalNode) => node.id !== centerId && node.type !== "project";

  const expansions = expanded
    .map((id) => expansionResults[id] as LocalGraphData | Error | undefined)
    .filter((r): r is LocalGraphData => r !== undefined && !(r instanceof Error));
  const merged = mergeLocalGraphs(graph, expansions);
  const mergedKey = localGraphKey(merged);

  // force-graph mutates the objects it is handed, so they are rebuilt only
  // when the graph's content changes. A node already on the canvas carries
  // its position and velocity into the new object, so an expansion grows the
  // star instead of re-laying it out; a new node starts at the seed.
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [data, setData] = useState<{ nodes: LocalNode[]; links: LocalLink[] }>({ nodes: [], links: [] });
  if (sourceKey !== mergedKey) {
    setSourceKey(mergedKey);
    const previous = new Map(data.nodes.map((n) => [n.id, n]));
    setData({
      nodes: merged.nodes.map((n, i): LocalNode => {
        // Only the centre is pinned; the rest are the simulation's.
        if (n.id === centerId) return { ...n, fx: 0, fy: 0 };
        const prev = previous.get(n.id);
        if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy };
        if (!seed) return { ...n };
        // A little spread (golden-angle steps), so the new nodes push apart
        // rather than stack.
        const angle = i * 2.39996;
        return { ...n, x: seed.x + Math.cos(angle) * 4, y: seed.y + Math.sin(angle) * 4 };
      }),
      links: merged.links.map((l) => ({ ...l })),
    });
  }

  // The canvas reads the hovered id while painting (a ref, no re-render per
  // frame); the caption is React state, so it updates once per hover change.
  const hoveredRef = useRef<string | null>(null);
  const [hovered, setHovered] = useState<LocalNode | null>(null);
  // Ripples in flight, read by the frame painter; dropped once spent.
  const burstsRef = useRef<Burst[]>([]);
  const [reducedMotion] = useState(
    () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  // Forces live on the simulation, which outlives every data change: set once.
  // No centring force — the pinned centre is the anchor.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("center", null);
    fg.d3Force("link")?.distance(LINK_DISTANCE);
    fg.d3Force("charge")?.strength(CHARGE);
  }, []);

  // The nodes force-graph is simulating, for the tick handler to clamp. A
  // ref, not `data`: positions are written onto these objects every tick,
  // and React state may not be mutated.
  const nodesRef = useRef<LocalNode[]>([]);
  useEffect(() => {
    nodesRef.current = data.nodes;
  }, [data]);

  // Every tick: hold the view at 1:1 with the origin centred, then keep
  // each node inside it. force-graph re-derives its own
  // zoom from the node count when data arrives (after our effects), so a
  // one-off `zoom(1)` was overridden — and a clamp computed for 1:1 then let
  // nodes off the edge of a 2x canvas. Re-asserting the view where the clamp
  // runs makes the bounds true pixels whatever force-graph did.
  // The canvas sits inside the box's 1px border.
  const canvasW = width - 2;
  const canvasH = height - 2;
  const halfW = canvasW / 2 - EDGE_PADDING;
  const top = -(canvasH / 2) + EDGE_PADDING;
  const bottom = canvasH / 2 - EDGE_PADDING;
  const onTick = () => {
    const fg = fgRef.current;
    if (fg && fg.zoom() !== 1) {
      fg.zoom(1, 0);
      fg.centerAt(0, 0, 0);
    }
    clampNodes(nodesRef.current, { halfW, top, bottom });
  };

  const muted = isDark ? "#737373" : "#a3a3a3";
  const strong = isDark ? "#e5e5e5" : "#262626";
  const linkMuted = isDark ? "rgba(115,115,115,0.6)" : "rgba(163,163,163,0.7)";

  // The visible world rectangle: the view is held at 1:1 with the origin at
  // the canvas centre (see `onTick`), so world units are CSS pixels.
  const bounds: Bounds = { left: -canvasW / 2, right: canvasW / 2 - 1, top: -canvasH / 2, bottom: canvasH / 2 - 1 };

  // Under links and nodes: each click's burst of faint rings, spreading
  // and thinning out over well under a second.
  const paintBursts = (ctx: CanvasRenderingContext2D) => {
    if (burstsRef.current.length === 0) return;
    const now = performance.now() / 1000;
    const lifetime = BURST_RING_SEC + (BURST_RINGS - 1) * BURST_GAP_SEC;
    burstsRef.current = burstsRef.current.filter((b) => now - b.start < lifetime);
    ctx.save();
    ctx.globalAlpha = RING_ALPHA;
    for (const burst of burstsRef.current) {
      ctx.fillStyle = burst.color;
      for (let i = 0; i < BURST_RINGS; i++) {
        const phase = (now - burst.start - i * BURST_GAP_SEC) / BURST_RING_SEC;
        if (phase < 0 || phase >= 1) continue;
        const strength = Math.pow(1 - phase, 1.4) * RING_STRENGTH;
        ditherRing(ctx, burst.x, burst.y, NODE_RADIUS + phase * BURST_RADIUS, strength, bounds);
      }
    }
    ctx.restore();
  };

  const paintNode = (node: LocalNode, ctx: CanvasRenderingContext2D) => {
    const isCenter = node.id === centerId;
    const isHovered = hoveredRef.current === node.id;
    const radius = isCenter ? CENTER_RADIUS : isHovered ? NODE_RADIUS + 1.5 : NODE_RADIUS;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = isCenter
      ? strong
      : isHovered
        ? getNodeColor(node.type, isDark)
        : expanded.includes(node.id)
          ? strong
          : muted;
    ctx.fill();
  };

  // Drop `id` from the expansions, then every expansion whose node it alone
  // brought in — click order puts a parent before what was expanded from it,
  // so one pass rebuilds what is still reachable.
  const collapse = (id: string) => {
    const reachable = new Set(graph.nodes.map((n) => n.id));
    const kept: string[] = [];
    for (const e of expanded) {
      if (e === id || !reachable.has(e)) continue;
      kept.push(e);
      const result = expansionResults[e] as LocalGraphData | Error | undefined;
      if (result && !(result instanceof Error)) for (const n of result.nodes) reachable.add(n.id);
    }
    setExpanded(kept);
  };

  const linkTouchesHovered = (link: LocalLink) => {
    const id = hoveredRef.current;
    if (!id) return false;
    const end = (e: string | LocalNode) => (typeof e === "string" ? e : e.id);
    return end(link.source) === id || end(link.target) === id;
  };

  const CaptionIcon = hovered ? (RESOURCE_TYPE_ICONS[hovered.type] ?? null) : null;

  const openHint = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘-click to open" : "Ctrl+click to open";

  return (
    <div style={{ width }}>
      {/* A contour box, not a glow: the star reads as its own figure. */}
      <div ref={wrapperRef} className="relative overflow-hidden rounded-lg border" style={{ width, height }}>
        <ForceGraph2D
          ref={fgRef}
          width={canvasW}
          height={canvasH}
          graphData={data}
          nodeCanvasObject={paintNode}
          // force-graph's own tooltip follows the cursor showing `name`; the
          // caption below already names the hovered node.
          nodeLabel={() => ""}
          nodePointerAreaPaint={(node: LocalNode, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, NODE_RADIUS + 5, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          onNodeClick={(node: LocalNode, event: MouseEvent) => {
            if (event.ctrlKey || event.metaKey) {
              const route = node.id === centerId ? null : getNodeRoute(node, workspaceId);
              if (route) void navigate(route);
              return;
            }
            if (!canExpand(node)) return;
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            if (!reducedMotion) {
              burstsRef.current.push({
                x,
                y,
                start: performance.now() / 1000,
                color: getNodeColor(node.type, isDark),
              });
            }
            if (expanded.includes(node.id)) {
              collapse(node.id);
            } else {
              setSeed({ x, y });
              setExpanded([...expanded, node.id]);
            }
          }}
          onNodeHover={(node: LocalNode | null) => {
            const neighbour = node && node.id !== centerId ? node : null;
            hoveredRef.current = neighbour?.id ?? null;
            setHovered(neighbour);
            if (wrapperRef.current) {
              // A click expands or collapses it; a project only opens.
              const clickable = neighbour && (canExpand(neighbour) || getNodeRoute(neighbour, workspaceId));
              wrapperRef.current.style.cursor = clickable ? "pointer" : "default";
            }
          }}
          linkColor={(link: LocalLink) => {
            if (!linkTouchesHovered(link)) return linkMuted;
            return getNodeColor(hovered?.type ?? "", isDark);
          }}
          linkWidth={1}
          backgroundColor="rgba(0,0,0,0)"
          onRenderFramePre={paintBursts}
          onEngineTick={onTick}
          cooldownTicks={120}
          d3VelocityDecay={0.4}
          // Keep painting after the layout settles, or hover never shows.
          autoPauseRedraw={false}
          enableNodeDrag={false}
          enableZoomInteraction={false}
          enablePanInteraction={false}
        />
      </div>
      {/* Outside the box, in the Context list's type size: it names the
          hovered node without covering any of the graph. */}
      <div
        aria-live="polite"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground"
        style={{ height: LOCAL_GRAPH_CAPTION_HEIGHT }}
      >
        {hovered && (
          <>
            {CaptionIcon && (
              <CaptionIcon className="h-3.5 w-3.5 shrink-0" style={{ color: getNodeColor(hovered.type, isDark) }} />
            )}
            <span className="truncate">{hovered.name}</span>
            {getNodeRoute(hovered, workspaceId) && (
              <span className="shrink-0 text-xs opacity-60">· {openHint}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
