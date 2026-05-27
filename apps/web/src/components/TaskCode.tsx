import type { ReactNode } from "react";
import { formatTaskId } from "@/lib/task-utils";
import { cn } from "@/lib/utils";

type Props = {
  /** Anything carrying the project key + per-project task number. */
  task: { projectKey?: string; number?: number };
  /** Extra classes merged over the default `font-mono text-xs text-muted-foreground`. */
  className?: string;
  /**
   * Rendered when the task has no code yet (missing project key / number).
   * Defaults to nothing; pass a sized placeholder where layout must not shift
   * (e.g. the kanban card reserves a line of height).
   */
  fallback?: ReactNode;
};

/**
 * The human-facing task code (`PROJ-12`), rendered consistently everywhere a
 * task is shown. Single home for both the `projectKey`-`number` formatting (via
 * `formatTaskId`) and the muted-mono presentation, so call sites stop
 * re-implementing either.
 */
export function TaskCode({ task, className, fallback = null }: Props) {
  const code = formatTaskId(task.projectKey, task.number);
  if (!code) return <>{fallback}</>;
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)}>
      {code}
    </span>
  );
}
