import { useQuery } from "convex-helpers/react/cache";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type ProjectTask = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.listByProject>>>[number];

/**
 * For views that inherently render both axes (kanban, calendar, overview,
 * project details). Fires both queries upfront and concatenates. Pagination
 * isn't useful here because these views aren't lists — they're spatial /
 * temporal layouts that need the whole bounded result set.
 *
 * The narrower list-view (Tasks.tsx) uses a different shape: a single active
 * query when the user is on the active view, and a paginated indexed
 * `listCompletedByProject` when they switch to completed.
 */
export function useEagerProjectTasks(
  projectId: Id<"projects">,
): ProjectTask[] | undefined {
  const active = useQuery(api.tasks.listByProject, {
    projectId,
    completed: false,
  });
  const completed = useQuery(api.tasks.listByProject, {
    projectId,
    completed: true,
  });

  return useMemo(() => {
    if (active === undefined || completed === undefined) return undefined;
    return [...active, ...completed];
  }, [active, completed]);
}
