import type { Id } from "@convex/_generated/dataModel";
import type { TaskFilters, TaskSort, TaskPriority } from "./TaskToolbar";

export type CompletedFilterArg =
  | { kind: "tag";      tagName: string }
  | { kind: "assignee"; assigneeId: Id<"users"> }
  | { kind: "priority"; priority: TaskPriority };

export type CompletedSortArg = "created" | "dueDate" | "plannedStartDate";

/**
 * Map the toolbar's TaskFilters (which may carry up to one entry per axis in
 * completed mode, enforced by the toolbar) to the strict union expected by
 * `listCompletedByProject`. Only the FIRST non-empty axis wins; the toolbar's
 * mutex makes that unambiguous.
 *
 * Returns `undefined` when no filter axis is selected — the backend's no-
 * filter branch is a pure indexed scan.
 */
export function deriveCompletedFilter(filters: TaskFilters): CompletedFilterArg | undefined {
  if (filters.tags.length > 0) {
    return { kind: "tag", tagName: filters.tags[0] };
  }
  if (filters.assigneeIds.length > 0) {
    return { kind: "assignee", assigneeId: filters.assigneeIds[0] as Id<"users"> };
  }
  if (filters.priorities.length > 0) {
    return { kind: "priority", priority: filters.priorities[0] };
  }
  return undefined;
}

/**
 * Translate the toolbar's SortField (which uses the legacy "startDate" key
 * for historical reasons) into the indexed sort axis on the completed query.
 *
 * Note: the existing client-side sort reads `task.startDate` (the deprecated
 * column). The completed query reads `task.plannedStartDate` (the actual
 * column). Mapping "startDate" → "plannedStartDate" surfaces the real data.
 *
 * Direction is forced to descending on the completed view — the indexed
 * ranges all use natural-desc ordering, and ascending would make optional
 * date fields surface at the top, which isn't a useful default.
 */
export function deriveCompletedSort(sort: TaskSort): CompletedSortArg {
  if (!sort) return "created";
  if (sort.field === "dueDate") return "dueDate";
  if (sort.field === "startDate") return "plannedStartDate";
  return "created";
}
