import type { TaskFilters, TaskSort } from "./TaskToolbar";

type FilterableTask = {
  _id: string;
  _creationTime: number;
  completed: boolean;
  priority: "urgent" | "high" | "medium" | "low";
  assigneeId?: string;
  dueDate?: string;
  startDate?: string;
  position?: string;
  labels?: string[];
  [key: string]: unknown;
};

export function useFilteredTasks<T extends FilterableTask>(
  tasks: T[] | undefined,
  filters: TaskFilters,
  sort: TaskSort,
): T[] | undefined {
  if (!tasks) return undefined;

  let result = tasks;

  // The list view (Tasks.tsx) partitions active vs completed at the query
  // layer, so this filter is a no-op there. The kanban view, however, loads
  // both partitions concatenated and renders all columns at once — it
  // relies on this client-side pass to honor the toolbar's view mode.
  if (filters.completionFilter === "uncompleted") {
    result = result.filter((t) => !t.completed);
  } else if (filters.completionFilter === "completed") {
    result = result.filter((t) => t.completed);
  }

  // Filter by assignee
  if (filters.assigneeIds.length > 0) {
    result = result.filter(
      (t) => t.assigneeId && filters.assigneeIds.includes(t.assigneeId)
    );
  }

  // Filter by priority
  if (filters.priorities.length > 0) {
    result = result.filter((t) => filters.priorities.includes(t.priority));
  }

  // Filter by tag (OR semantics: match any selected tag, mirrors assignee).
  // Tasks store tags in the denormalized `labels` array kept in sync by
  // syncTagsForResource on every create/update.
  if (filters.tags.length > 0) {
    result = result.filter(
      (t) => t.labels && filters.tags.some((tag) => t.labels!.includes(tag))
    );
  }

  // Sort
  if (sort) {
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case "created":
          cmp = a._creationTime - b._creationTime;
          break;
        case "dueDate": {
          // Tasks without dates sort to the end
          const aDate = a.dueDate ?? "";
          const bDate = b.dueDate ?? "";
          if (!aDate && !bDate) cmp = 0;
          else if (!aDate) cmp = 1;
          else if (!bDate) cmp = -1;
          else cmp = aDate.localeCompare(bDate);
          break;
        }
        case "startDate": {
          const aDate = a.startDate ?? "";
          const bDate = b.startDate ?? "";
          if (!aDate && !bDate) cmp = 0;
          else if (!aDate) cmp = 1;
          else if (!bDate) cmp = -1;
          else cmp = aDate.localeCompare(bDate);
          break;
        }
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }

  return result;
}
