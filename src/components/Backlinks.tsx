import { useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BacklinksProps = {
  resourceId: string;
  workspaceId: Id<"workspaces">;
};

type Backlink = {
  _id: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  embeds: "Embedded",
  blocks: "Blocks",
  relates_to: "Related",
};

function getSourceLink(ref: Backlink): string {
  if (ref.sourceType === "document") {
    return `/workspaces/${ref.workspaceId}/documents/${ref.sourceId}`;
  }
  if (ref.sourceType === "task" && ref.projectId) {
    return `/workspaces/${ref.workspaceId}/projects/${ref.projectId}/tasks/${ref.sourceId}`;
  }
  if (ref.sourceType === "diagram") {
    return `/workspaces/${ref.workspaceId}/diagrams/${ref.sourceId}`;
  }
  if (ref.sourceType === "spreadsheet") {
    return `/workspaces/${ref.workspaceId}/spreadsheets/${ref.sourceId}`;
  }
  return "#";
}

export function Backlinks({ resourceId, workspaceId }: BacklinksProps) {
  const backlinks = useQuery(api.edges.getBacklinks, {
    targetId: resourceId,
    workspaceId,
  });
  const [expanded, setExpanded] = useState(false);

  if (!backlinks || backlinks.length === 0) return null;

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="font-medium">Referenced in</span>
        <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono tabular-nums">
          {backlinks.length}
        </Badge>
      </button>

      {expanded && (
        <ul className="mt-1 space-y-0.5 pl-4 animate-fade-in">
          {backlinks.map((ref) => {
            const Icon = RESOURCE_TYPE_ICONS[ref.sourceType] ?? RESOURCE_TYPE_ICONS.document;
            const edgeLabel = EDGE_TYPE_LABELS[ref.edgeType] ?? ref.edgeType;
            return (
              <li key={ref._id} className="flex items-center gap-2 text-sm py-0.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Link
                  to={getSourceLink(ref)}
                  className="truncate hover:underline text-foreground"
                >
                  {ref.sourceName}
                </Link>
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {edgeLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
