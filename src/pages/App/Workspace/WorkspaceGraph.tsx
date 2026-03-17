import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from "react-force-graph-2d";
import { getNodeColor, getNodeSize } from "./graphConstants";

type GraphNode = NodeObject & {
  id: string;
  type: string;
  groupId?: string;
  isolated?: boolean;
};

type GraphLink = LinkObject & {
  source: string | GraphNode;
  target: string | GraphNode;
  edgeType: string;
};

function getNodeRoute(node: GraphNode, workspaceId: string): string | null {
  if (node.isolated) return null;
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

// Types that get isolated placeholder nodes from aggregate counts
const COUNTABLE_TYPES = ["document", "diagram", "spreadsheet", "project", "channel", "task"] as const;

type WorkspaceGraphProps = {
  workspaceId: Id<"workspaces">;
  width: number;
  height: number;
  hiddenTypes: Set<string>;
  highlightedType?: string | null;
};

export function WorkspaceGraph({ workspaceId, width, height, hiddenTypes, highlightedType }: WorkspaceGraphProps) {
  const graph = useQuery(api.edges.getWorkspaceGraph, { workspaceId });
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

  // ── Lazy label loading with 200ms debounce ──────────────────────────
  const labelCacheRef = useRef(new Map<string, string>());
  const [labelQuery, setLabelQuery] = useState<{ id: string; type: string } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const labelResult = useQuery(
    api.edges.getNodeLabel,
    labelQuery ? { id: labelQuery.id, type: labelQuery.type } : "skip",
  );

  // Cache the label result when it arrives
  useEffect(() => {
    if (labelResult && labelQuery) {
      labelCacheRef.current.set(labelQuery.id, labelResult);
    }
  }, [labelResult, labelQuery]);


  // Clamp node positions on every tick
  const handleEngineTick = useCallback(() => {
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
  }, [width, height]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      const route = getNodeRoute(node, workspaceId);
      if (route) void navigate(route);
    },
    [navigate, workspaceId],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    hoveredNodeRef.current = node?.id ?? null;
    if (wrapperRef.current) {
      wrapperRef.current.style.cursor = node && !node.isolated ? "pointer" : "default";
    }

    // Clear pending timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    // Start 200ms debounce for label fetch
    if (node && !node.isolated && !labelCacheRef.current.has(node.id)) {
      const nodeId = node.id;
      const nodeType = node.type;
      hoverTimerRef.current = setTimeout(() => {
        setLabelQuery({ id: nodeId, type: nodeType });
      }, 200);
    }
  }, []);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      const size = getNodeSize(node.type);
      const color = getNodeColor(node.type, isDark);
      const isHovered = hoveredNodeRef.current === node.id;
      const ht = highlightedTypeRef.current;
      const isTypeHighlighted = ht === node.type
        || (ht === "channel" && node.type === "message")
        || (ht === "project" && node.type === "task");
      const isHighlighted = isHovered || isTypeHighlighted;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      // Isolated nodes are slightly transparent
      const alpha = node.isolated ? 0.4 : 1;

      if (isHighlighted) {
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Show label: from cache if available, only when zoomed in or highlighted
      const zoom = ctx.getTransform().a;
      if (zoom > 3 || isHighlighted) {
        const cachedLabel = node.isolated ? undefined : labelCacheRef.current.get(node.id);
        if (cachedLabel) {
          const label = cachedLabel.length > 20 ? cachedLabel.slice(0, 18) + "…" : cachedLabel;
          ctx.font = `${isHighlighted ? "bold " : ""}3px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
          ctx.fillText(label, x, y + size + 2);
        }
      }
    },
    [isDark],
  );

  // Build graph data: connected nodes from edges + anonymous isolated nodes from counts
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    // Connected nodes from edges (no names)
    const connectedNodes = (graph.nodes as GraphNode[]).filter((n) => !hiddenTypes.has(n.type));
    const visibleIds = new Set(connectedNodes.map((n) => n.id));

    // Count connected nodes per type, including group parents
    // (channels referenced by message groupId, projects referenced by task groupId)
    const connectedCounts = new Map<string, number>();
    const countedIds = new Set<string>();
    for (const node of connectedNodes) {
      if (!countedIds.has(node.id)) {
        countedIds.add(node.id);
        connectedCounts.set(node.type, (connectedCounts.get(node.type) ?? 0) + 1);
      }
      // Group parent is implicitly connected
      if (node.groupId && !countedIds.has(node.groupId)) {
        countedIds.add(node.groupId);
        // Infer parent type from child type
        const parentType = node.type === "task" ? "project" : node.type === "message" ? "channel" : undefined;
        if (parentType) {
          connectedCounts.set(parentType, (connectedCounts.get(parentType) ?? 0) + 1);
        }
      }
    }

    // Generate anonymous isolated nodes from aggregate counts
    const isolatedNodes: GraphNode[] = [];
    const counts = graph.counts as Record<string, number>;
    for (const type of COUNTABLE_TYPES) {
      if (hiddenTypes.has(type)) continue;
      const total = counts[type] ?? 0;
      const connected = connectedCounts.get(type) ?? 0;
      const isolatedCount = Math.max(0, total - connected);
      for (let i = 0; i < isolatedCount; i++) {
        isolatedNodes.push({
          id: `__isolated_${type}_${i}`,
          type,
          isolated: true,
        });
      }
    }

    const allNodes = [...connectedNodes, ...isolatedNodes];

    // Filter links
    const links = (graph.links as GraphLink[]).filter((l) => {
      const sourceId = typeof l.source === "string" ? l.source : l.source.id;
      const targetId = typeof l.target === "string" ? l.target : l.target.id;
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });

    // Synthetic "contains" links (project→task, channel→message)
    const groupLinks: GraphLink[] = [];
    const seen = new Set<string>();
    for (const node of allNodes) {
      if (node.groupId && visibleIds.has(node.groupId)) {
        const key = `${node.groupId}→${node.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          groupLinks.push({
            source: node.groupId,
            target: node.id,
            edgeType: "contains",
          });
        }
      }
    }

    return { nodes: allNodes, links: [...links, ...groupLinks] };
  }, [graph, hiddenTypes]);

  useEffect(() => {
    nodesRef.current = graphData.nodes;
  }, [graphData]);

  if (!graph) return null;

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ width, height }}>
        All node types are hidden. Click a type in the legend to show it.
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="overflow-hidden" style={{ width, height }}>
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
          const et = typeof link.edgeType === "string" ? link.edgeType : "";
          if (et === "contains") return isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
          return isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
        }}
        linkWidth={(link: GraphLink) => {
          const et = typeof link.edgeType === "string" ? link.edgeType : "";
          return et === "contains" ? 0.3 : 0.5;
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
    </div>
  );
}
