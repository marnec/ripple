import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from "react-force-graph-2d";
import { getNodeColor, getNodeSize } from "./graphConstants";

type GraphNode = NodeObject & {
  id: string;
  type: string;
  name: string;
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
  highlightedTypeRef.current = highlightedType ?? null;
  const nodesRef = useRef<GraphNode[]>([]);


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
      wrapperRef.current.style.cursor = node ? "pointer" : "default";
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

      if (isHighlighted) {
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = isTypeHighlighted && !isHovered
        ? color  // full color, slightly larger effect from glow
        : color;
      ctx.fill();

      const label = node.name.length > 20 ? node.name.slice(0, 18) + "…" : node.name;
      ctx.font = `${isHighlighted ? "bold " : ""}3px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
      ctx.fillText(label, x, y + size + 2);
    },
    [isDark],
  );

  // Filter graph data and add synthetic group links (project→task, channel→message)
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const nodes = (graph.nodes as GraphNode[]).filter((n) => !hiddenTypes.has(n.type));
    const visibleIds = new Set(nodes.map((n) => n.id));

    const links = (graph.links as GraphLink[]).filter((l) => {
      const sourceId = typeof l.source === "string" ? l.source : l.source.id;
      const targetId = typeof l.target === "string" ? l.target : l.target.id;
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });

    // Add synthetic "contains" links from group parent to child
    // (project→task, channel→message) for visual clustering
    const groupLinks: GraphLink[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
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

    return { nodes, links: [...links, ...groupLinks] };
  }, [graph, hiddenTypes]);

  useEffect(() => {
    nodesRef.current = graphData.nodes;
  }, [graphData]);

  if (!graph) return null;

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ width, height }}>
        {graph.nodes.length === 0
          ? "No connections yet. Mention resources in documents, tasks, or chat to build the graph."
          : "All node types are hidden. Click a type in the legend to show it."}
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
