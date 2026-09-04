import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
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
 *
 * Because the tag filter and completion axis are query *arguments*, changing
 * either opens a new subscription that reads `undefined` until it lands. The
 * last loaded list is held across that gap so the page keeps its content and
 * rows enter / exit through the list's AnimatePresence, instead of the whole
 * view collapsing to a spinner and remounting. Same derived-state pattern as
 * Tasks.tsx; `undefined` is only ever returned before the first load.
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

  const live = filters.completionFilter === "uncompleted" ? active : completed;
  // setState-during-render is React's derived-state pattern; the Object.is
  // guard prevents a loop, and an undefined `live` is deliberately not
  // written so the previous list stays up until fresh data arrives.
  const [held, setHeld] = useState(live);
  if (live !== undefined && !Object.is(live, held)) {
    setHeld(live);
  }

  const truncated = (held?.length ?? 0) > MY_TASKS_CAP;
  return { tasks: truncated ? held!.slice(0, MY_TASKS_CAP) : held, truncated };
}
