import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type TaskSuggestionsOptions = {
  workspaceId: Id<"workspaces"> | undefined;
  editor: any;
  /** Max tasks offered. Default is the server's own default (7). */
  limit?: number;
};

/**
 * Returns a `getItems` callback for BlockNote's `#` suggestion menu that offers
 * the workspace's open tasks.
 *
 * Server-side search (`tasks.suggest`) rather than a `useQuery` over every open
 * task in the workspace — the composer is mounted in every channel, so that
 * subscription was carried by every chat view at once.
 */
export function useTaskSuggestions({ workspaceId, editor, limit }: TaskSuggestionsOptions) {
  const convex = useConvex();
  return async (query: string) => {
    if (!workspaceId) return [];
    const trimmed = query.trim();

    const tasks = await convex.query(api.tasks.suggest, {
      workspaceId,
      query: trimmed.length > 0 ? trimmed : undefined,
      limit,
    });

    return tasks.map((task) => ({
      title: task.title,
      onItemClick: () => {
        editor.insertInlineContent([
          { type: "taskMention", props: { taskId: task._id, taskTitle: task.title } },
          " ",
        ]);
      },
      icon: <div className={cn("h-3 w-3 rounded-full", task.statusColor || "bg-gray-500")} />,
      group: "Tasks",
    }));
  };
}
