import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { TaskFilters } from "./TaskToolbar";

type AssigneeTask = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.listByAssignee>>>[number];

/**
 * Newest assigned tasks My Tasks shows per completion axis. Past this the
 * view says so and points at the project list view, which paginates. Must
 * stay below the query's own server-side clamp.
 */
export const MY_TASKS_CAP = 200;

/**
 * Lazy-completed pattern for the assignee-scoped query (MyTasks). Subscribes
 * to the active set always; the completed set only when the toolbar's
 * completion filter is "completed". Returns the single relevant set.
 *
 * The tag filter goes to the server: it drives an indexed `taskTags` join,
 * and filtering client-side inside a capped page would silently drop
 * matches past the cap. Priority stays client-side (no indexed path for it
 * on the assignee axis) and is lossy under the cap in the same way the
 * kanban's done column already is.
 *
 * `truncated` is the +1 trick: the query is asked for one more than the cap.
 */
export function useDualAssigneeTasks(
  workspaceId: Id<"workspaces"> | undefined,
  filters: TaskFilters,
): { tasks: AssigneeTask[] | undefined; truncated: boolean } {
  const tagNames = filters.tags.length > 0 ? filters.tags : undefined;
  const active = useQuery(
    api.tasks.listByAssignee,
    workspaceId && filters.completionFilter === "uncompleted"
      ? { workspaceId, completed: false, tagNames, limit: MY_TASKS_CAP + 1 }
      : "skip",
  );
  const completed = useQuery(
    api.tasks.listByAssignee,
    workspaceId && filters.completionFilter === "completed"
      ? { workspaceId, completed: true, tagNames, limit: MY_TASKS_CAP + 1 }
      : "skip",
  );

  const raw = filters.completionFilter === "uncompleted" ? active : completed;
  const truncated = (raw?.length ?? 0) > MY_TASKS_CAP;
  return { tasks: truncated ? raw!.slice(0, MY_TASKS_CAP) : raw, truncated };
}
