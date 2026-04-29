import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CompletionFilter } from "./TaskToolbar";

type AssigneeTask = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.listByAssignee>>>[number];

/**
 * Lazy-completed pattern for the assignee-scoped query (MyTasks). Subscribes
 * to the active set always; the completed set only when the toolbar's
 * completion filter is "completed". Returns the single relevant set —
 * the legacy "all" merge mode no longer exists.
 *
 * NOTE: completed-side tag/assignee/priority filters here are still applied
 * client-side via `useFilteredTasks`. Bringing this view under the
 * indexed-only completed contract (matching `listCompletedByProject`) is a
 * tracked follow-up in the README.
 */
export function useDualAssigneeTasks(
  workspaceId: Id<"workspaces"> | undefined,
  completionFilter: CompletionFilter,
): AssigneeTask[] | undefined {
  const active = useQuery(
    api.tasks.listByAssignee,
    workspaceId && completionFilter === "uncompleted" ? { workspaceId, completed: false } : "skip",
  );
  const completed = useQuery(
    api.tasks.listByAssignee,
    workspaceId && completionFilter === "completed" ? { workspaceId, completed: true } : "skip",
  );

  return completionFilter === "uncompleted" ? active : completed;
}
