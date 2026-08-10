import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { useTaskDetail } from "./useTaskDetail";

/**
 * The state every task-detail section reads. Lives apart from `TaskDetail.tsx`
 * only because a module that exports both components and hooks defeats Fast
 * Refresh; the provider and the sections themselves are over there.
 */
export type TaskDetailValue = ReturnType<typeof useTaskDetail> & {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  taskId: Id<"tasks"> | null;
};

export const TaskDetailContext = createContext<TaskDetailValue | null>(null);

/**
 * Read the task-detail state. Only for shells and sections *inside* a
 * `TaskDetailProvider` — throws otherwise rather than silently rendering an
 * empty surface.
 */
export function useTaskDetailContext(): TaskDetailValue {
  const value = useContext(TaskDetailContext);
  if (!value) {
    throw new Error("TaskDetail sections must be rendered inside <TaskDetailProvider>");
  }
  return value;
}
