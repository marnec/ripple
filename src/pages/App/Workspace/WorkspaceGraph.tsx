import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from "react-force-graph-2d";

type GraphNode = NodeObject & {
  id: string;
  type: string;
  name: string;
};

type GraphLink = LinkObject & {
  source: string | GraphNode;
  target: string | GraphNode;
  edgeType: string;
};

const NODE_COLORS: Record<string, { light: string; dark: string }> = {
  document: { light: "#3b82f6", dark: "#60a5fa" },
  task: { light: "#8b5cf6", dark: "#a78bfa" },
  diagram: { light: "#f59e0b", dark: "#fbbf24" },
  spreadsheet: { light: "#10b981", dark: "#34d399" },
  user: { light: "#ec4899", dark: "#f472b6" },
  project: { light: "#f97316", dark: "#fb923c" },
  channel: { light: "#06b6d4", dark: "#22d3ee" },
  message: { light: "#06b6d4", dark: "#22d3ee" },
};

const NODE_SIZE: Record<string, number> = {
  document: 5,
  task: 4,
  diagram: 5,
  spreadsheet: 5,
  user: 6,
  project: 7,
  channel: 6,
  message: 3,
};

function getNodeColor(type: string, isDark: boolean): string {
  const colors = NODE_COLORS[type] ?? { light: "#6b7280", dark: "#9ca3af" };
  return isDark ? colors.dark : colors.light;
}

function getNodeSize(type: string): number {
  return NODE_SIZE[type] ?? 4;
}

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


export function WorkspaceGraph({ workspaceId, width: propWidth, height: propHeight }: { workspaceId: Id<"workspaces">; width: number; height: number }) {
  const graph = useQuery(api.edges.getWorkspaceGraph, { workspaceId });
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
  const hoveredNodeRef = useRef<string | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const width = propWidth;
  const height = propHeight;



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
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      const label = node.name.length > 20 ? node.name.slice(0, 18) + "…" : node.name;
      ctx.font = `${isHovered ? "bold " : ""}3px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
      ctx.fillText(label, x, y + size + 2);
    },
    [isDark],
  );

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    return { nodes: graph.nodes as GraphNode[], links: graph.links as GraphLink[] };
  }, [graph]);

  useEffect(() => {
    nodesRef.current = graphData.nodes;
  }, [graphData]);

  if (!graph) return null;

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No connections yet. Mention resources in documents, tasks, or chat to build the graph.
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="overflow-hidden relative" style={{ width, height }}>
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
          linkColor={() => isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}
          linkWidth={0.5}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          autoPauseRedraw={false}
          enableNodeDrag={true}
          enableZoomInteraction={true}
          enablePanInteraction={true}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground pointer-events-none">
        {["document", "task", "diagram", "spreadsheet", "user", "project", "channel"].map((type) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: getNodeColor(type, isDark) }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
