import { useMemo } from "react";
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
  [key: string]: unknown;
};

export function useFilteredTasks<T extends FilterableTask>(
  tasks: T[] | undefined,
  filters: TaskFilters,
  sort: TaskSort,
): T[] | undefined {
  return useMemo(() => {
    if (!tasks) return undefined;

    let result = tasks;

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
  }, [tasks, filters.assigneeIds, filters.priorities, sort]);
}
