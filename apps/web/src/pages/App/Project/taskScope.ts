import type { Id } from "@convex/_generated/dataModel";

/** Which slice of a project's tasks a view shows: one cycle, or the backlog (no cycle). */
export type TaskScope =
  | { kind: "cycle"; cycleId: Id<"cycles"> }
  | { kind: "backlog" };

/** The `cycleId` argument `tasks.listByProject` takes for a scope. */
export function scopeCycleArg(scope: TaskScope): Id<"cycles"> | null {
  return scope.kind === "cycle" ? scope.cycleId : null;
}

/** The cycle new tasks created in this view go into (undefined → the backlog). */
export function scopeCreateCycle(scope: TaskScope): Id<"cycles"> | undefined {
  return scope.kind === "cycle" ? scope.cycleId : undefined;
}
