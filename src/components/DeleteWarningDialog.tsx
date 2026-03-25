import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useQuery } from "convex/react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Reference = {
  _id: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
};

type DeleteWarningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  resourceId: string;
  workspaceId: Id<"workspaces">;
  resourceType: "diagram" | "document" | "spreadsheet";
  resourceName: string;
  preloadedReferences?: Reference[];
};

const PAGE_SIZE = 5;

const SOURCE_TYPE_LABELS: Record<string, { label: string; icon: (typeof RESOURCE_TYPE_ICONS)[string] }> = {
  document: { label: "Document", icon: RESOURCE_TYPE_ICONS.document },
  task: { label: "Task", icon: RESOURCE_TYPE_ICONS.task },
};

function getSourceLink(ref: Reference): string {
  if (ref.sourceType === "document") {
    return `/workspaces/${ref.workspaceId}/documents/${ref.sourceId}`;
  }
  if (ref.sourceType === "task" && ref.projectId) {
    return `/workspaces/${ref.workspaceId}/projects/${ref.projectId}/tasks/${ref.sourceId}`;
  }
  return "#";
}

export function DeleteWarningDialog({
  open,
  onOpenChange,
  onConfirm,
  resourceId,
  workspaceId,
  resourceType,
  resourceName,
  preloadedReferences,
}: DeleteWarningDialogProps) {
  const queriedReferences = useQuery(
    api.edges.getBacklinks,
    open && !preloadedReferences ? { targetId: resourceId, workspaceId } : "skip",
  );

  const references = preloadedReferences ?? queriedReferences;
  const hasReferences = references && references.length > 0;
  const isLoading = references === undefined && open;

  const [page, setPage] = useState(0);

  const totalPages = hasReferences ? Math.ceil(references.length / PAGE_SIZE) : 0;
  // Clamp page to valid range (resets naturally when references change)
  const safePage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const pageItems = hasReferences
    ? references.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
    : [];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Delete {resourceType}?
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription render={<div />}>
              {isLoading && (
                <span className="text-muted-foreground">Checking for references...</span>
              )}
              {hasReferences && (
                <>
                  <span className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-medium mb-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    &ldquo;{resourceName}&rdquo; is embedded in {references.length}{" "}
                    {references.length === 1 ? "place" : "places"}:
                  </span>
                  <ul className="space-y-1.5 mb-2">
                    {pageItems.map((ref: Reference) => {
                      const config = SOURCE_TYPE_LABELS[ref.sourceType] ?? SOURCE_TYPE_LABELS.document;
                      const Icon = config.icon;
                      const href = getSourceLink(ref);
                      return (
                        <li key={ref._id} className="flex items-center gap-2 text-sm">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Link
                            to={href}
                            className="truncate hover:underline text-foreground"
                            onClick={() => onOpenChange(false)}
                          >
                            {ref.sourceName}
                          </Link>
                          <span className="text-muted-foreground text-xs shrink-0">({config.label})</span>
                        </li>
                      );
                    })}
                  </ul>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => p - 1)}
                        disabled={safePage === 0}
                        className="h-7 px-2"
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                        Prev
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {safePage + 1} / {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={safePage >= totalPages - 1}
                        className="h-7 px-2"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    These embeds will appear as broken after deletion. This action cannot be undone.
                  </p>
                </>
              )}
              {!isLoading && !hasReferences && (
                <span>
                  Are you sure you want to delete &ldquo;{resourceName}&rdquo;? This action cannot be undone.
                </span>
              )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            Delete
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
