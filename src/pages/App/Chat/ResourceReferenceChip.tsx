import { useQuery } from "convex/react";
import { File, PenTool, Table2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useMentionedResources } from "./MentionedUsersContext";

const RESOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  document: File,
  diagram: PenTool,
  spreadsheet: Table2,
};

const RESOURCE_ROUTES: Record<string, string> = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
};

type ResourceReferenceChipProps = {
  resourceId: string;
  resourceType: string;
};

export function ResourceReferenceChip({ resourceId, resourceType }: ResourceReferenceChipProps) {
  const mentionedResources = useMentionedResources();
  const cached = mentionedResources[resourceId];
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  // Determine which query to use as fallback based on type
  const resolvedType = cached?.type || resourceType;
  const doc = useQuery(
    api.documents.get,
    !cached && resolvedType === "document" ? { id: resourceId as Id<"documents"> } : "skip"
  );
  const diagram = useQuery(
    api.diagrams.get,
    !cached && resolvedType === "diagram" ? { id: resourceId as Id<"diagrams"> } : "skip"
  );
  const spreadsheet = useQuery(
    api.spreadsheets.get,
    !cached && resolvedType === "spreadsheet" ? { id: resourceId as Id<"spreadsheets"> } : "skip"
  );

  const fallback = doc || diagram || spreadsheet;
  const name = cached?.name || fallback?.name;
  const type = resolvedType;

  if (!name) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground text-sm align-middle">
        #inaccessible-{type || "resource"}
      </span>
    );
  }

  const Icon = RESOURCE_ICONS[type] || File;
  const route = RESOURCE_ROUTES[type] || "documents";

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigate(`/workspaces/${workspaceId}/${route}/${resourceId}`);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5
                 rounded-full bg-background/60 hover:bg-background/80
                 transition-colors cursor-pointer text-sm font-medium align-middle"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="max-w-50 truncate">{name}</span>
    </button>
  );
}
