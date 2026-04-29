import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";

type KanbanCompletedOverflowProps = {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

/**
 * Bottom-of-column pill rendered in each completed-status kanban column when
 * the project has more completed tasks than the kanban shows. Clicking it
 * jumps to the project tasks list view with the completion filter pre-set,
 * which is built for scanning many.
 *
 * The exact hidden count is intentionally not shown — the kanban only knows
 * "more than 20", not the precise total, and computing it would cost an
 * extra full scan of the completed set.
 */
export function KanbanCompletedOverflow({
  workspaceId,
  projectId,
}: KanbanCompletedOverflowProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() =>
        void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, {
          state: { initialCompletionFilter: "completed" },
        })
      }
      className="group flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-border/70 bg-transparent px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground cursor-pointer"
    >
      <span className="truncate">
        Older completed tasks
      </span>
      <span className="flex items-center gap-1">
        View all
        <ArrowRight className="h-3 w-3" />
      </span>
    </button>
  );
}
