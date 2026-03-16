import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex/react";
import {
  Clock,
  FileText,
  Hash,
  LayoutGrid,
  Network,
  PenTool,
  Settings,
  Table,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import { QueryParams } from "@shared/types/routes";
import { WorkspaceTimeline } from "./WorkspaceTimeline";
import { WorkspaceGraph } from "./WorkspaceGraph";
import { NODE_TYPES, getNodeColor } from "./graphConstants";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "next-themes";

const overviewCards = [
  { key: "members", label: "Members", icon: Users, to: "settings" },
  { key: "channels", label: "Channels", icon: Hash, to: "channels" },
  { key: "projects", label: "Projects", icon: LayoutGrid, to: "projects" },
  { key: "documents", label: "Documents", icon: FileText, to: "documents" },
  { key: "diagrams", label: "Diagrams", icon: PenTool, to: "diagrams" },
  { key: "spreadsheets", label: "Spreadsheets", icon: Table, to: "spreadsheets" },
] as const;

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

  // Node type visibility for graph filtering
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
    <div className="animate-fade-in">
      <div ref={topRef} className="container mx-auto p-4 space-y-4">
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

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {overviewCards.map((card) => {
            const count = overview?.[card.key];
            return (
              <Link
                key={card.key}
                to={card.to}
                className="group flex flex-col items-center gap-1.5 rounded-lg border p-4 text-center transition-colors hover:bg-accent/50"
              >
                <card.icon className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                <span className="text-2xl font-semibold tabular-nums">
                  {count ?? "\u2013"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {card.label}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Tabs + legend */}
        <div className="flex items-center gap-1 flex-wrap">
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

          {/* Node type filter switches — only shown on graph tab */}
          {activeTab === "graph" && !isMobile && (
            <div className="flex items-center gap-4 ml-auto">
              {NODE_TYPES.map((type) => {
                const isVisible = !hiddenTypes.has(type);
                const color = getNodeColor(type, isDark);
                return (
                  <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
                    <Switch
                      size="sm"
                      checked={isVisible}
                      onCheckedChange={() => toggleType(type)}
                      style={isVisible ? { backgroundColor: color } : undefined}
                    />
                    <span className="text-xs text-muted-foreground capitalize">{type}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "activity" && (
        <div className="container mx-auto px-4 pb-4">
          <WorkspaceTimeline workspaceId={id} />
        </div>
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
