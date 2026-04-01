import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex-helpers/react/cache";
import {
  Clock,
  Eye,
  EyeOff,
  FileText,
  Hash,
  LayoutGrid,
  ListTodo,
  Network,
  PenTool,
  Settings,
  Table,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import type { QueryParams } from "@shared/types/routes";
import { WorkspaceTimeline } from "./WorkspaceTimeline";
import { getNodeColor } from "./graphConstants";

const LazyWorkspaceGraph = React.lazy(() =>
  import("./WorkspaceGraph").then((m) => ({ default: m.WorkspaceGraph })),
);
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "next-themes";

type OverviewCard = {
  key: string;
  filterType: string;        // singular type for graph filtering
  label: string;
  icon: LucideIcon;
  to: string;
  subCount?: { key: string; label: string; icon: LucideIcon; filterType?: string };
};

const overviewCards: OverviewCard[] = [
  { key: "members", filterType: "user", label: "Members", icon: Users, to: "settings" },
  { key: "channels", filterType: "channel", label: "Channels", icon: Hash, to: "channels" },
  {
    key: "tasks", filterType: "task", label: "Tasks", icon: ListTodo, to: "projects",
    subCount: { key: "projects", label: "Projects", icon: LayoutGrid, filterType: "project" },
  },
  { key: "documents", filterType: "document", label: "Documents", icon: FileText, to: "documents" },
  { key: "diagrams", filterType: "diagram", label: "Diagrams", icon: PenTool, to: "diagrams" },
  { key: "spreadsheets", filterType: "spreadsheet", label: "Spreadsheets", icon: Table, to: "spreadsheets" },
];

type Tab = "graph" | "activity";

export function WorkspaceDetails() {
  const { workspaceId } = useParams<QueryParams>();
  const id = workspaceId as Id<"workspaces">;
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("graph");
  const effectiveTab: Tab = isMobile && activeTab === "graph" ? "activity" : activeTab;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const workspace = useQuery(api.workspaces.get, { id });
  const graph = useQuery(api.edges.getWorkspaceGraph, { workspaceId: id });

  // Derive counts from graph nodes (replaces aggregate count queries)
  const overview = (() => {
    if (!graph) return undefined;
    const c: Record<string, number> = {};
    for (const n of graph.nodes) {
      const key = n.type === "user" ? "members" : `${n.type}s`;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  })();

  // Node type visibility for graph/activity filtering
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [highlightedType, setHighlightedType] = useState<string | null>(null);
  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Measure the top section height so the graph can fill the remainder
  const topRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(0);
  const [graphHeight, setGraphHeight] = useState(0);

  useEffect(() => {
    if (effectiveTab !== "graph" || !topRef.current) return;
    const update = () => {
      const topEl = topRef.current;
      if (!topEl) return;
      const topH = topEl.offsetHeight;
      const w = topEl.clientWidth - 32;
      const h = window.innerHeight - 64 - topH - 16;
      setGraphWidth(Math.max(200, w));
      setGraphHeight(Math.max(200, h));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topRef.current);
    return () => ro.disconnect();
  }, [effectiveTab]);

  if (workspace === null) {
    return <ResourceDeleted resourceType="workspace" />;
  }

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100vh-64px)]">
      <div ref={topRef} className="container mx-auto p-4 space-y-4 shrink-0">
        <div className="hidden md:flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {workspace?.name ?? "\u00A0"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {workspace?.description || "No description available."}
            </p>
          </div>
          <Button size="sm" variant="outline" render={<Link to={`/workspaces/${workspaceId}/settings`} />} className="inline-flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </div>

        {/* Resource cards with integrated filter toggles */}
        <div className="grid gap-2 md:gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {overviewCards.map((card) => {
            const count = overview ? (overview[card.key] ?? 0) : undefined;
            const subCount = card.subCount && overview ? (overview[card.subCount.key] ?? 0) : undefined;
            const color = getNodeColor(card.filterType, isDark);
            const isHidden = hiddenTypes.has(card.filterType);
            const subFilterType = card.subCount?.filterType ?? card.subCount?.key;
            const isSubHidden = subFilterType ? hiddenTypes.has(subFilterType) : false;

            if (card.subCount && subFilterType) {
              // Dual counter card: primary + sub side by side, independent hover/hide
              return (
                <div
                  key={card.key}
                  className="group relative flex items-stretch rounded-lg border text-center overflow-hidden"
                >
                  <Link to={`/workspaces/${workspaceId}/${card.to}`} className="absolute inset-0 z-0" aria-label={`${card.label} and ${card.subCount.label}`} />

                  {/* Left side: primary type */}
                  <div
                    className={cn(
                      "relative z-1 flex flex-col items-center justify-center gap-0.5 flex-1 p-3 md:p-4 transition-all cursor-pointer",
                      isHidden ? "opacity-40" : "hover:bg-accent/50",
                    )}
                    onClick={() => void navigate(`/workspaces/${workspaceId}/${card.to}`)}
                    onMouseEnter={() => setHighlightedType(card.filterType)}
                    onMouseLeave={() => setHighlightedType(null)}
                  >
                    <card.icon className="size-3.5 md:size-4 transition-colors" style={{ color }} />
                    <span className="text-lg md:text-xl font-semibold tabular-nums">{count ?? "\u2013"}</span>
                    <span className="text-[10px] md:text-[11px] text-muted-foreground">{card.label}</span>
                  </div>

                  <div className="relative z-1 w-px h-8 self-center bg-border shrink-0" />

                  {/* Right side: sub type */}
                  <div
                    className={cn(
                      "relative z-1 flex flex-col items-center justify-center gap-0.5 flex-1 p-3 md:p-4 transition-all cursor-pointer",
                      isSubHidden ? "opacity-40" : "hover:bg-accent/50",
                    )}
                    onClick={() => void navigate(`/workspaces/${workspaceId}/${card.to}`)}
                    onMouseEnter={() => setHighlightedType(subFilterType)}
                    onMouseLeave={() => setHighlightedType(null)}
                  >
                    <card.subCount.icon className="size-3.5 md:size-4 transition-colors" style={{ color: getNodeColor(subFilterType, isDark) }} />
                    <span className="text-lg md:text-xl font-semibold tabular-nums">{subCount ?? "\u2013"}</span>
                    <span className="text-[10px] md:text-[11px] text-muted-foreground">{card.subCount.label}</span>
                  </div>

                  {/* Eye toggles: left for primary, right for sub */}
                  {!isMobile && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleType(card.filterType); }}
                        className="absolute top-2 left-2 z-10 p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        title={isHidden ? `Show ${card.label}` : `Hide ${card.label}`}
                      >
                        {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleType(subFilterType); }}
                        className="absolute top-2 right-2 z-10 p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        title={isSubHidden ? `Show ${card.subCount.label}` : `Hide ${card.subCount.label}`}
                      >
                        {isSubHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </>
                  )}
                </div>
              );
            }

            // Single counter card
            return (
              <div
                key={card.key}
                className={cn(
                  "group relative flex flex-col items-center gap-1 md:gap-1.5 rounded-lg border p-3 md:p-4 text-center transition-all cursor-pointer",
                  isHidden ? "opacity-40" : "hover:bg-accent/50",
                )}
                onClick={() => void navigate(`/workspaces/${workspaceId}/${card.to}`)}
                onMouseEnter={() => setHighlightedType(card.filterType)}
                onMouseLeave={() => setHighlightedType(null)}
              >
                <Link to={`/workspaces/${workspaceId}/${card.to}`} className="absolute inset-0 z-0" aria-label={card.label} />
                {!isMobile && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleType(card.filterType); }}
                    className="absolute top-2 right-2 z-10 p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title={isHidden ? `Show ${card.label}` : `Hide ${card.label}`}
                  >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                )}
                <div className="flex flex-col items-center gap-1 md:gap-1.5">
                  <card.icon className="size-4 md:size-5 transition-colors" style={{ color }} />
                  <span className="text-xl md:text-2xl font-semibold tabular-nums">{count ?? "\u2013"}</span>
                  <span className="text-xs text-muted-foreground">{card.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        {isMobile ? (
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-0.5">Activity</p>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("graph")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                effectiveTab === "graph"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Network className="h-3.5 w-3.5" />
              Graph
            </button>
            <button
              onClick={() => setActiveTab("activity")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                effectiveTab === "activity"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              Activity
            </button>
            {effectiveTab === "graph" && (
              <span className="text-[11px] text-muted-foreground/50 ml-2">
                Hover a node to reveal its name
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tab content */}
      {effectiveTab === "activity" && (
        isMobile ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-2 pb-4">
              <WorkspaceTimeline workspaceId={id} hiddenTypes={hiddenTypes} />
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="container mx-auto px-4 pb-4">
              <WorkspaceTimeline workspaceId={id} hiddenTypes={hiddenTypes} />
            </div>
          </ScrollArea>
        )
      )}
      {effectiveTab === "graph" && !isMobile && graphWidth > 0 && graphHeight > 0 && (
        <div className="container mx-auto px-4 pb-4 overflow-hidden">
          <Suspense fallback={<div style={{ width: graphWidth, height: graphHeight }} />}>
            <LazyWorkspaceGraph workspaceId={id} graph={graph} width={graphWidth} height={graphHeight} hiddenTypes={hiddenTypes} highlightedType={highlightedType} />
          </Suspense>
        </div>
      )}

      {isMobile && (
        <HeaderSlot>
          <Link
            to="settings"
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Workspace settings"
          >
            <Settings className="size-4" />
          </Link>
        </HeaderSlot>
      )}
    </div>
  );
}
