import { describe, it, expect } from "vitest";
import { useFilteredTasks } from "./useTaskFilters";
import type { TaskFilters } from "./TaskToolbar";

const noFilters: TaskFilters = {
  completionFilter: "uncompleted",
  assigneeIds: [],
  priorities: [],
  tags: [],
};

const task = (id: string, priority: "urgent" | "high" | "medium" | "low") => ({
  _id: id,
  _creationTime: 0,
  completed: false,
  priority,
});

describe("useFilteredTasks priority sort", () => {
  const tasks = [task("m", "medium"), task("u", "urgent"), task("l", "low"), task("h", "high")];

  it("puts urgent first when descending", () => {
    const sorted = useFilteredTasks(tasks, noFilters, { field: "priority", direction: "desc" });
    expect(sorted?.map((t) => t._id)).toEqual(["u", "h", "m", "l"]);
  });

  it("puts low first when ascending", () => {
    const sorted = useFilteredTasks(tasks, noFilters, { field: "priority", direction: "asc" });
    expect(sorted?.map((t) => t._id)).toEqual(["l", "m", "h", "u"]);
  });

  it("keeps the incoming order among equal priorities", () => {
    const tied = [task("a", "high"), task("b", "urgent"), task("c", "high")];
    const sorted = useFilteredTasks(tied, noFilters, { field: "priority", direction: "desc" });
    expect(sorted?.map((t) => t._id)).toEqual(["b", "a", "c"]);
  });
});
