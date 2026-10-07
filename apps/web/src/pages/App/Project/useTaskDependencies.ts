import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type DependencyType = "blocks" | "is_blocked_by" | "relates_to";

/**
 * A task's dependencies and the two ways to change them, shared by the
 * collapsible section and the mobile chip (`TaskDependenciesPill`). Owns the
 * mapping from the UI's three relations onto stored `blocks`/`relates_to`
 * edges, so the two surfaces cannot disagree about which way an edge points.
 */
export function useTaskDependencies(taskId: Id<"tasks">) {
  const deps = useQuery(api.edges.listByTask, { taskId });
  const createDep = useMutation(api.edges.createEdge);
  const removeDep = useMutation(api.edges.removeEdge);

  const { blocks, blockedBy, relatesTo } = deps ?? { blocks: [], blockedBy: [], relatesTo: [] };

  const add = async (selectedTaskId: Id<"tasks">, uiType: DependencyType) => {
    if (uiType === "is_blocked_by") {
      // "this task is blocked by selected" → selectedTask blocks thisTask
      // Storage: {taskId: selected, dependsOnTaskId: this, type: "blocks"}
      await createDep({ taskId: selectedTaskId, dependsOnTaskId: taskId, type: "blocks" });
    } else if (uiType === "blocks") {
      // "this task blocks selected"
      // Storage: {taskId: this, dependsOnTaskId: selected, type: "blocks"}
      await createDep({ taskId, dependsOnTaskId: selectedTaskId, type: "blocks" });
    } else {
      // relates_to — direction doesn't matter semantically
      await createDep({ taskId, dependsOnTaskId: selectedTaskId, type: "relates_to" });
    }
  };

  return {
    loaded: deps !== undefined,
    blocks,
    blockedBy,
    relatesTo,
    totalCount: blocks.length + blockedBy.length + relatesTo.length,
    /** Already linked, or the task itself: never offered as a new target. */
    existingTaskIds: new Set<string>([
      taskId,
      ...blocks.map((d) => d.task._id),
      ...blockedBy.map((d) => d.task._id),
      ...relatesTo.map((d) => d.task._id),
    ]),
    add,
    remove: (edgeId: Id<"edges">) => void removeDep({ edgeId }),
  };
}
