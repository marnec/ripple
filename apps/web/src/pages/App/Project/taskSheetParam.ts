import { useSearchParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";

/**
 * The task open in a project surface's `TaskDetailSheet`, as `?task=<id>`.
 * In the URL so the task page can send you back to the surface you expanded
 * from with the sheet still open — and so a refresh or a shared link keeps it.
 */
export const TASK_SHEET_PARAM = "task";

/**
 * The open sheet's task id, and its setter (`null` closes). Updates replace
 * the history entry, like the task views' filters: Back leaves the page
 * rather than stepping through every task opened on it.
 */
export function useTaskSheetParam(): [Id<"tasks"> | null, (taskId: Id<"tasks"> | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = (searchParams.get(TASK_SHEET_PARAM) as Id<"tasks"> | null) || null;
  const setTaskId = (next: Id<"tasks"> | null) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set(TASK_SHEET_PARAM, next);
        else params.delete(TASK_SHEET_PARAM);
        return params;
      },
      { replace: true },
    );
  return [taskId, setTaskId];
}

/** Router state the sheet's "expand" hands the task page. */
export type TaskPageLocationState = {
  /** Path + search of the surface the sheet was open on. */
  sheetReturnTo?: string;
};

/**
 * Where the task page's "back to sheet" goes: the surface the sheet was
 * expanded from, with this task open in it — the page may have moved on to
 * another task since. Only a surface of the task's own project qualifies (a
 * dashboard sheet does not read `?task`); anything else, or no origin at
 * all, lands on the project's tasks page.
 */
export function sheetReturnHref({
  returnTo,
  workspaceId,
  projectId,
  taskId,
}: {
  returnTo: string | undefined;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): string {
  const projectBase = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [path, search = ""] = (returnTo ?? "").split("?");
  const valid =
    (path === projectBase || path.startsWith(`${projectBase}/`)) &&
    !path.startsWith(`${projectBase}/tasks/`);
  const params = new URLSearchParams(valid ? search : "");
  params.set(TASK_SHEET_PARAM, taskId);
  return `${valid ? path : `${projectBase}/tasks`}?${params.toString()}`;
}
