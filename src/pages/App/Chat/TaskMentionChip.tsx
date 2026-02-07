import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useMentionedTasks } from "./MentionedUsersContext";

interface TaskMentionChipProps {
  taskId: string; // comes from data attribute as string
}

export function TaskMentionChip({ taskId }: TaskMentionChipProps) {
  const mentionedTasks = useMentionedTasks();
  const cached = mentionedTasks[taskId];

  const task = useQuery(api.tasks.get, cached ? "skip" : {
    taskId: taskId as Id<"tasks">,
  });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  if (cached) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void navigate(`/workspaces/${workspaceId}/projects/${cached.projectId}`, {
        state: { highlightTaskId: taskId },
      });
    };

    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/60 hover:bg-background/80 transition-colors cursor-pointer text-sm font-medium align-middle"
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            cached.statusColor || "bg-gray-500"
          )}
        />
        <span className="max-w-50 truncate">{cached.title}</span>
      </button>
    );
  }

  if (!task) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground text-sm align-middle">
        #deleted-task
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigate(`/workspaces/${workspaceId}/projects/${task.projectId}`, {
      state: { highlightTaskId: taskId },
    });
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/60 hover:bg-background/80 transition-colors cursor-pointer text-sm font-medium align-middle"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          task.status?.color || "bg-gray-500"
        )}
      />
      <span className="max-w-50 truncate">{task.title}</span>
    </button>
  );
}
