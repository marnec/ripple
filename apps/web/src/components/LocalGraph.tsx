import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { getNodeColor } from "@/pages/App/Workspace/graphConstants";

const NODE_RADIUS = 3;
const CENTER_RADIUS = 4.5;

type LocalNode = NodeObject & {
  id: string;
  type: string;
  name?: string;
  groupId?: string;
};

type LocalLink = LinkObject & { source: string | LocalNode; target: string | LocalNode; edgeType: string };

export type LocalGraphData = {
  nodes: Array<{ id: string; type: string; name?: string; groupId?: string }>;
  links: Array<{ source: string; target: string; edgeType: string }>;
};

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
 * The **local graph** canvas (CONTEXT.md): one resource pinned at the centre
 * and its direct neighbours around it, from `graph.getLocalGraph`.
 *
 * Deliberately not `WorkspaceGraph`: that one carries node positions across
 * live payloads of hundreds of nodes. A depth-1 star is a handful of nodes, so
 * this rebuilds on every payload. No labels and no colour at rest — it sits
 * beside a list that already names every node.
 */
export default function LocalGraph({
  centerId,
  workspaceId,
  graph,
  width,
  height,
}: {
  centerId: string;
  workspaceId: string;
  graph: LocalGraphData;
  width: number;
  height: number;
}) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const fgRef = useRef<ForceGraphMethods<LocalNode, LocalLink>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // force-graph writes positions onto the objects it is handed, so they must
  // keep their identity across renders and change only with the payload —
  // rebuilt here when `graph` changes, not on every render.
  const [source, setSource] = useState<LocalGraphData | null>(null);
  const [data, setData] = useState<{ nodes: LocalNode[]; links: LocalLink[] }>({ nodes: [], links: [] });
  if (source !== graph) {
    setSource(graph);
    setData({
      // The centre is pinned (fx/fy) so the star never drifts off the canvas.
      nodes: graph.nodes.map((n) => (n.id === centerId ? { ...n, fx: 0, fy: 0 } : { ...n })),
      links: graph.links.map((l) => ({ ...l })),
    });
  }

  // Monochrome by default: the list beside the graph carries names and types,
  // so the canvas only has to show shape. A node takes its type colour while
  // hovered, which is the one moment the type is the question.
  const hoveredRef = useRef<string | null>(null);

  const paintNode = (node: LocalNode, ctx: CanvasRenderingContext2D) => {
    const isCenter = node.id === centerId;
    const isHovered = hoveredRef.current === node.id;
    const size = isCenter ? CENTER_RADIUS : NODE_RADIUS;
    const tone = isDark
      ? (isCenter ? "#d4d4d4" : "#737373")
      : (isCenter ? "#404040" : "#a3a3a3");

    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, isHovered ? size + 0.5 : size, 0, 2 * Math.PI);
    ctx.fillStyle = isHovered ? getNodeColor(node.type, isDark) : tone;
    ctx.fill();
  };

  return (
    <div ref={wrapperRef} className="overflow-hidden rounded-md" style={{ width, height }}>
      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={data}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: LocalNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, CENTER_RADIUS + 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={(node: LocalNode) => {
          if (node.id === centerId) return;
          const route = getNodeRoute(node, workspaceId);
          if (route) void navigate(route);
        }}
        onNodeHover={(node: LocalNode | null) => {
          hoveredRef.current = node?.id ?? null;
          if (wrapperRef.current) {
            const clickable = node && node.id !== centerId && getNodeRoute(node, workspaceId);
            wrapperRef.current.style.cursor = clickable ? "pointer" : "default";
          }
        }}
        onEngineStop={() => fgRef.current?.zoomToFit(300, 24)}
        linkColor={() => (isDark ? "rgba(115,115,115,0.5)" : "rgba(163,163,163,0.5)")}
        linkWidth={0.75}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={100}
        // Keep painting after the layout settles, or hover colour never shows.
        autoPauseRedraw={false}
        d3VelocityDecay={0.5}
        enableNodeDrag={false}
        enableZoomInteraction={false}
        enablePanInteraction={false}
      />
    </div>
  );
}
