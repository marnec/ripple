import { Badge } from "@ripple/ui/components/badge";
import { Button } from "@ripple/ui/components/button";
import { formatTaskId } from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { Link } from "react-router-dom";

type DependencyItem = {
  edgeId: Id<"edges">;
  task: {
    _id: Id<"tasks">;
    projectId: Id<"projects">;
    title: string;
    number?: number;
    projectKey?: string;
    completed: boolean;
  };
};

/**
 * One relation's dependencies — "Blocked by", "Blocks", "Related to" — each
 * row removable. The list view of the dependencies chip
 * (`TaskDependenciesPill`); data and writes come from `useTaskDependencies`.
 */
export function DependencyGroup({
  label,
  icon,
  items,
  onRemove,
  hrefFor,
}: {
  label: string;
  icon: React.ReactNode;
  items: DependencyItem[];
  onRemove: (id: Id<"edges">) => void;
  /**
   * Make each title a link to that task — only as wide as the title, as in
   * the Context list it sits in on the full page.
   */
  hrefFor?: (task: DependencyItem["task"]) => string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {items.map((item) => {
        const taskIdStr = formatTaskId(item.task.projectKey, item.task.number);
        return (
          <div
            key={item.edgeId}
            className="flex items-center gap-2 pl-5 group"
          >
            {taskIdStr && (
              <Badge variant="outline" className="font-mono text-xs px-1.5 py-0">
                {taskIdStr}
              </Badge>
            )}
            {hrefFor ? (
              <span className="min-w-0 flex-1">
                <Link
                  to={hrefFor(item.task)}
                  className={cn(
                    "inline-block max-w-full truncate align-top text-sm hover:underline",
                    item.task.completed && "line-through text-muted-foreground",
                  )}
                >
                  {item.task.title}
                </Link>
              </span>
            ) : (
              <span
                className={cn(
                  "text-sm truncate flex-1",
                  item.task.completed && "line-through text-muted-foreground"
                )}
              >
                {item.task.title}
              </span>
            )}
            <Button
              aria-label={`Remove ${label.toLowerCase()} ${taskIdStr ?? item.task.title}`}
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:h-8 pointer-coarse:w-8 pointer-coarse:opacity-100"
              onClick={() => onRemove(item.edgeId)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
