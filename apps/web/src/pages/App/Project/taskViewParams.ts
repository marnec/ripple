import { PRIORITIES, type TaskPriority } from "@/lib/task-utils";
import type { SortField, TaskFilters, TaskSort } from "./TaskToolbar";
import type { TaskGroupBy } from "./groupTasks";

/**
 * The project task page's view state, carried in the URL so it survives a
 * refresh and the back button, and so a filtered view is a link you can
 * bookmark or paste to a colleague.
 *
 *   ?show=completed&assignee=<id>&priority=high&tag=bug&sort=dueDate&dir=desc&view=list&group=assignee
 *
 * Defaults are omitted, so the unfiltered page is the bare URL. Multi-valued
 * axes repeat their key rather than joining with a separator — tags are free
 * text.
 */
export type TaskView = "list" | "board";

export type TaskViewState = {
  filters: TaskFilters;
  sort: TaskSort;
  view: TaskView;
  /**
   * Stored as chosen; it only takes effect on the list view of active tasks
   * (the page decides), so switching away and back restores it.
   */
  group: TaskGroupBy | null;
};

const SORT_FIELDS: readonly SortField[] = ["created", "dueDate", "startDate", "priority"];
const PRIORITY_VALUES: readonly string[] = PRIORITIES.map((p) => p.value);

export function parseTaskViewParams(params: URLSearchParams): TaskViewState {
  const completionFilter = params.get("show") === "completed" ? "completed" : "uncompleted";
  const assigneeIds = unique(params.getAll("assignee").filter(Boolean));
  const priorities = unique(
    params.getAll("priority").filter((p): p is TaskPriority => PRIORITY_VALUES.includes(p)),
  );
  const tags = unique(params.getAll("tag").map((t) => t.trim().toLowerCase()).filter(Boolean));

  let filters: TaskFilters = { completionFilter, assigneeIds, priorities, tags };
  if (completionFilter === "completed") filters = enforceCompletedMutex(filters);

  const sortField = params.get("sort");
  const sort: TaskSort = SORT_FIELDS.includes(sortField as SortField)
    ? { field: sortField as SortField, direction: params.get("dir") === "desc" ? "desc" : "asc" }
    : null;

  const view: TaskView = params.get("view") === "list" ? "list" : "board";
  const group: TaskGroupBy | null = params.get("group") === "assignee" ? "assignee" : null;

  return { filters, sort, view, group };
}

export function serializeTaskViewParams(state: Partial<TaskViewState>): URLSearchParams {
  const params = new URLSearchParams();
  const { filters, sort, view, group } = state;
  if (filters) {
    if (filters.completionFilter === "completed") params.set("show", "completed");
    for (const id of filters.assigneeIds) params.append("assignee", id);
    for (const p of filters.priorities) params.append("priority", p);
    for (const t of filters.tags) params.append("tag", t);
  }
  if (sort) {
    params.set("sort", sort.field);
    params.set("dir", sort.direction);
  }
  if (view === "list") params.set("view", "list");
  if (group) params.set("group", group);
  return params;
}

/** `?…` suffix for links that land on the task page with a preset view. */
export function taskViewSearch(state: {
  filters?: Partial<TaskFilters>;
  sort?: TaskSort;
  view?: TaskView;
}): string {
  const params = serializeTaskViewParams({
    filters: state.filters && {
      completionFilter: "uncompleted",
      assigneeIds: [],
      priorities: [],
      tags: [],
      ...state.filters,
    },
    sort: state.sort,
    view: state.view,
  });
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * The completed view runs every filter as one indexed range scan, so it
 * takes at most one axis with one value (see `TaskFilters`). The toolbar
 * enforces this as you click; a hand-edited URL has to be brought back into
 * line here. The first non-empty axis wins, in toolbar order.
 */
function enforceCompletedMutex(filters: TaskFilters): TaskFilters {
  const empty = { assigneeIds: [], priorities: [], tags: [] };
  if (filters.assigneeIds.length > 0)
    return { ...filters, ...empty, assigneeIds: filters.assigneeIds.slice(0, 1) };
  if (filters.priorities.length > 0)
    return { ...filters, ...empty, priorities: filters.priorities.slice(0, 1) };
  if (filters.tags.length > 0) return { ...filters, ...empty, tags: filters.tags.slice(0, 1) };
  return filters;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
