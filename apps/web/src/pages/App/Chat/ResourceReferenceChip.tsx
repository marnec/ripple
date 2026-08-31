import { useQuery } from "convex-helpers/react/cache";
import { File } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMentionedResources } from "./MentionedUsersContext";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { cn } from "@/lib/utils";

const RESOURCE_ICONS = RESOURCE_TYPE_ICONS;

const RESOURCE_ROUTES: Record<string, string> = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
};

type ResourceReferenceChipProps = {
  resourceId: string;
  resourceType: string;
  /** A1 range this chip introduces, when it heads a frozen range table. */
  cellRef?: string;
  /**
   * `pill` is the chip as it reads mid-sentence, where the rounded fill is what
   * separates it from the words around it. `bare` drops the fill for the one
   * place that already frames it — the header of a frozen range panel — so the
   * panel does not end up with a second container inside its own header.
   */
  variant?: "pill" | "bare";
};

export function ResourceReferenceChip({
  resourceId,
  resourceType,
  cellRef,
  variant = "pill",
}: ResourceReferenceChipProps) {
  const bare = variant === "bare";
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
      <span
        className={cn(
          "inline-flex items-center gap-1 text-muted-foreground text-sm align-middle",
          bare ? "opacity-80" : "px-1.5 py-0.5 rounded-full bg-background/60",
        )}
      >
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
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 align-middle text-sm font-medium cursor-pointer transition-all",
        bare
          ? "opacity-75 hover:opacity-100 hover:underline underline-offset-2"
          : "px-2 py-0.5 rounded-full bg-background/60 hover:bg-background/80",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className={cn("truncate", bare ? "max-w-full" : "max-w-50")}>
        {name}
        {cellRef ? ` \u203A ${cellRef}` : ""}
      </span>
    </button>
  );
}
