import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "convex/react";
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, ListTodo } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";

type Reference = {
  _id: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  workspaceId: string;
  projectId?: string;
};

type DeleteWarningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  resourceId: string;
  resourceType: "diagram" | "document" | "spreadsheet";
  resourceName: string;
  preloadedReferences?: Reference[];
};

const PAGE_SIZE = 5;

const SOURCE_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  document: { label: "Document", icon: FileText },
  task: { label: "Task", icon: ListTodo },
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
  resourceType,
  resourceName,
  preloadedReferences,
}: DeleteWarningDialogProps) {
  const queriedReferences = useQuery(
    api.contentReferences.getReferencesTo,
    open && !preloadedReferences ? { targetId: resourceId } : "skip",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {resourceType}?
          </DialogTitle>
          <DialogDescription asChild>
            <div>
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
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
