/**
 * Pure decisions shared by every task-detail surface (the sheet and the full
 * page). Keeping them here — rather than re-deriving them in each shell — is
 * what stops the two surfaces from drifting apart: they were already answering
 * "has this loaded?" differently, and the sheet's answer stranded a deleted
 * task on a spinner forever.
 */
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import type { Id } from "@convex/_generated/dataModel";

/**
 * What a task-detail surface should be showing right now.
 *
 * - `loading` — a query the surface needs hasn't resolved yet.
 * - `deleted` — the task resolved to `null`; it is gone (deleted here, or by a
 *   collaborator while the surface was open).
 * - `ready` — the task and its supporting queries are all in hand.
 */
export type TaskDetailLoadState = "loading" | "deleted" | "ready";

export function taskDetailLoadState({
  task,
  statuses,
  members,
}: {
  /** `undefined` while in flight, `null` once the task is gone. */
  task: unknown;
  statuses: readonly unknown[] | undefined;
  members: readonly unknown[] | undefined;
}): TaskDetailLoadState {
  // Deletion is decided before loading: once the task is gone the supporting
  // queries can never make the surface renderable, so waiting on them would
  // spin forever.
  if (task === null) return "deleted";
  if (task === undefined || statuses === undefined || members === undefined) {
    return "loading";
  }
  return "ready";
}

/** The subset of `tasks.update` a detail surface can edit in place. */
export type TaskPatch = {
  title?: string;
  statusId?: Id<"taskStatuses">;
  priority?: "urgent" | "high" | "medium" | "low";
  assigneeId?: Id<"users"> | null;
  labels?: string[];
  dueDate?: string | null;
  plannedStartDate?: string | null;
  estimate?: number | null;
};

/**
 * Failure copy per editable field. Collapsing the nine per-property handlers
 * into one `patch` must not cost the user the specificity they had — before
 * this, `statusId` was the only field whose failure said anything at all (the
 * other eight silently swallowed the rejection).
 */
const PATCH_FAILURE_MESSAGE: Record<keyof TaskPatch, string> = {
  title: "Couldn't rename task",
  statusId: "Couldn't change status",
  priority: "Couldn't change priority",
  assigneeId: "Couldn't change assignee",
  labels: "Couldn't update tags",
  dueDate: "Couldn't change due date",
  plannedStartDate: "Couldn't change start date",
  estimate: "Couldn't change estimate",
};

function patchFailureMessage(fields: TaskPatch): string {
  const keys = Object.keys(fields) as Array<keyof TaskPatch>;
  const only = keys.length === 1 ? PATCH_FAILURE_MESSAGE[keys[0]] : undefined;
  return only ?? "Couldn't update task";
}

/**
 * Build the single write path for a task-detail surface.
 *
 * Every property edit goes through the returned `patch`, so the error path is
 * written once rather than once per field, and a surface with no task selected
 * simply cannot write. The returned function never rejects — callers fire it
 * and forget it, and a failure reaches the user as a toast.
 */
export function createTaskPatch({
  taskId,
  updateTask,
}: {
  taskId: Id<"tasks"> | null;
  updateTask: (args: TaskPatch & { taskId: Id<"tasks"> }) => Promise<unknown>;
}): (fields: TaskPatch) => Promise<void> {
  return async (fields) => {
    if (!taskId) return;
    try {
      await updateTask({ ...fields, taskId });
    } catch (err: unknown) {
      toast.error(patchFailureMessage(fields), {
        description: getErrorMessage(err),
      });
    }
  };
}
