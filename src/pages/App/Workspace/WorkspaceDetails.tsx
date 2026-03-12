import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex/react";
import {
  FileText,
  Hash,
  LayoutGrid,
  PenTool,
  Settings,
  Table,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { QueryParams } from "@shared/types/routes";

const overviewCards = [
  { key: "members", label: "Members", icon: Users, to: "settings" },
  { key: "channels", label: "Channels", icon: Hash, to: "channels" },
  { key: "projects", label: "Projects", icon: LayoutGrid, to: "projects" },
  { key: "documents", label: "Documents", icon: FileText, to: "documents" },
  { key: "diagrams", label: "Diagrams", icon: PenTool, to: "diagrams" },
  { key: "spreadsheets", label: "Spreadsheets", icon: Table, to: "spreadsheets" },
] as const;

export function WorkspaceDetails() {
  const { workspaceId } = useParams<QueryParams>();
  const id = workspaceId as Id<"workspaces">;
  const isMobile = useIsMobile();

  const workspace = useQuery(api.workspaces.get, { id });
  const overview = useQuery(api.workspaces.overview, { workspaceId: id });

  return (
    <div className="container mx-auto p-4 animate-fade-in">
      <div className="space-y-4">
        <div className="hidden md:flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {workspace?.name ?? "\u00A0"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {workspace?.description || "No description available."}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="settings" className="inline-flex items-center gap-1.5">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
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
      </div>

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
