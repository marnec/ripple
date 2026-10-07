export type TaskGroupBy = "assignee";

type GroupableTask = {
  assigneeId?: string;
  assignee: { name?: string; image?: string } | null;
};

export type AssigneeGroup<T> = {
  /** The assignee's id, or `null` for the unassigned group. */
  assigneeId: string | null;
  assignee: { name?: string; image?: string } | null;
  tasks: T[];
};

/**
 * Split a list into one section per assignee, alphabetical by name, with
 * unassigned tasks last. Tasks keep their incoming order inside a section, so
 * the toolbar's sort still applies within each group.
 */
export function groupTasksByAssignee<T extends GroupableTask>(tasks: T[]): AssigneeGroup<T>[] {
  const byId = new Map<string, AssigneeGroup<T>>();
  const unassigned: T[] = [];
  for (const task of tasks) {
    if (!task.assigneeId) {
      unassigned.push(task);
      continue;
    }
    let group = byId.get(task.assigneeId);
    if (!group) {
      group = { assigneeId: task.assigneeId, assignee: task.assignee, tasks: [] };
      byId.set(task.assigneeId, group);
    }
    group.tasks.push(task);
  }

  const groups = [...byId.values()].sort((a, b) =>
    (a.assignee?.name ?? "").localeCompare(b.assignee?.name ?? "", undefined, {
      sensitivity: "base",
    }),
  );
  if (unassigned.length > 0) groups.push({ assigneeId: null, assignee: null, tasks: unassigned });
  return groups;
}
