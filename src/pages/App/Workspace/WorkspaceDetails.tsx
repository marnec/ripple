import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex/react";
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
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import { QueryParams } from "@shared/types/routes";
import { WorkspaceTimeline } from "./WorkspaceTimeline";
import { WorkspaceGraph } from "./WorkspaceGraph";
import { getNodeColor } from "./graphConstants";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "next-themes";

type OverviewCard = {
  key: string;
  filterType: string;        // singular type for graph filtering
  label: string;
  icon: LucideIcon;
  to: string;
  subCount?: { key: string; label: string; icon: LucideIcon };
};

const overviewCards: OverviewCard[] = [
  { key: "members", filterType: "user", label: "Members", icon: Users, to: "settings" },
  { key: "channels", filterType: "channel", label: "Channels", icon: Hash, to: "channels" },
  {
    key: "projects", filterType: "project", label: "Projects", icon: LayoutGrid, to: "projects",
    subCount: { key: "tasks", label: "Tasks", icon: ListTodo },
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
  const [activeTab, setActiveTab] = useState<Tab>(isMobile ? "activity" : "graph");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const workspace = useQuery(api.workspaces.get, { id });
  const overview = useWorkspaceSidebar()?.counts;

  // Node type visibility for graph/activity filtering
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
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
    if (activeTab !== "graph" || !topRef.current) return;
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
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [activeTab]);

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
          <Button size="sm" variant="outline" render={<Link to="settings" />} className="inline-flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </div>

        {/* Resource cards with integrated filter toggles */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
          {overviewCards.map((card) => {
            const count = overview?.[card.key as keyof typeof overview];
            const subCount = card.subCount ? overview?.[card.subCount.key as keyof typeof overview] : undefined;
            const color = getNodeColor(card.filterType, isDark);
            const isHidden = hiddenTypes.has(card.filterType);
            const isSubHidden = card.subCount ? hiddenTypes.has("task") : false;

            return (
              <div
                key={card.key}
                className={cn(
                  "group relative flex flex-col items-center gap-1.5 rounded-lg border p-4 text-center transition-all",
                  isHidden ? "opacity-40" : "hover:bg-accent/50",
                )}
              >
                {/* Eye toggle — top right */}
                {!isMobile && (
                  <button
                    onClick={() => toggleType(card.filterType)}
                    className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title={isHidden ? `Show ${card.label}` : `Hide ${card.label}`}
                  >
                    {isHidden
                      ? <EyeOff className="size-3.5" />
                      : <Eye className="size-3.5" />
                    }
                  </button>
                )}

                {/* Clickable content — navigates to resource list */}
                <Link to={card.to} className="flex flex-col items-center gap-1.5">
                  <card.icon
                    className="size-5 transition-colors"
                    style={{ color }}
                  />
                  <span className="text-2xl font-semibold tabular-nums">
                    {count ?? "\u2013"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {card.label}
                  </span>
                </Link>

                {/* Sub-count (tasks inside projects) */}
                {card.subCount && subCount !== undefined && (
                  <div className={cn(
                    "flex items-center gap-1.5 mt-1 transition-opacity",
                    isSubHidden && "opacity-40",
                  )}>
                    {!isMobile && (
                      <button
                        onClick={() => toggleType("task")}
                        className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        title={isSubHidden ? "Show Tasks" : "Hide Tasks"}
                      >
                        {isSubHidden
                          ? <EyeOff className="size-3" />
                          : <Eye className="size-3" />
                        }
                      </button>
                    )}
                    <card.subCount.icon
                      className="size-3"
                      style={{ color: getNodeColor("task", isDark) }}
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {subCount} {card.subCount.label}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {!isMobile && (
            <button
              onClick={() => setActiveTab("graph")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeTab === "graph"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <Network className="h-3.5 w-3.5" />
              Graph
            </button>
          )}
          <button
            onClick={() => setActiveTab("activity")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === "activity"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            Activity
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "activity" && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="container mx-auto px-4 pb-4">
            <WorkspaceTimeline workspaceId={id} hiddenTypes={hiddenTypes} />
          </div>
        </ScrollArea>
      )}
      {activeTab === "graph" && !isMobile && graphWidth > 0 && graphHeight > 0 && (
        <div className="container mx-auto px-4 pb-4">
          <WorkspaceGraph workspaceId={id} width={graphWidth} height={graphHeight} hiddenTypes={hiddenTypes} />
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
