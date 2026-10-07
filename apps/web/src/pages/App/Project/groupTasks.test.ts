import { describe, it, expect } from "vitest";
import { groupTasksByAssignee } from "./groupTasks";

const task = (id: string, assigneeId?: string, name?: string) => ({
  id,
  assigneeId,
  assignee: assigneeId ? { name } : null,
});

describe("groupTasksByAssignee", () => {
  it("sorts groups by name and puts unassigned last", () => {
    const groups = groupTasksByAssignee([
      task("1"),
      task("2", "u-zoe", "Zoe"),
      task("3", "u-ada", "ada"),
      task("4", "u-zoe", "Zoe"),
    ]);
    expect(groups.map((g) => g.assigneeId)).toEqual(["u-ada", "u-zoe", null]);
  });

  it("keeps the incoming order inside each group", () => {
    const groups = groupTasksByAssignee([
      task("b", "u1", "Ann"),
      task("x"),
      task("a", "u1", "Ann"),
      task("y"),
    ]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([["b", "a"], ["x", "y"]]);
  });

  it("omits the unassigned group when every task has an assignee", () => {
    const groups = groupTasksByAssignee([task("1", "u1", "Ann")]);
    expect(groups.map((g) => g.assigneeId)).toEqual(["u1"]);
  });

  it("returns no groups for no tasks", () => {
    expect(groupTasksByAssignee([])).toEqual([]);
  });
});
