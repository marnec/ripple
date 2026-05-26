import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTaskGithubLink } from "./useTaskGithubLink";

type TaskSyncIndicatorProps = {
  taskId: Id<"tasks">;
};

/**
 * Renders a small amber affordance when a task's outbound GitHub sync has
 * permanently failed (4xx response) or exhausted retries (5xx/network). One
 * click re-enqueues the push.
 *
 * The component subscribes to its own query so kanban/task-list reads stay
 * off the high-churn `taskIntegrationLinks` table — see the Phase-1 PRD's
 * hot-path discipline.
 *
 * Renders nothing when:
 *  - the task has no link (Ripple-native task), or
 *  - the link has no `lastSyncError` (sync healthy / never tried).
 */
export function TaskSyncIndicator({ taskId }: TaskSyncIndicatorProps) {
  const { syncError } = useTaskGithubLink(taskId);
  const retry = useMutation(api.tasks.retryOutboundSync);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!syncError) return null;

  // Short label for the chip surface; full message lives in the tooltip.
  const { message, label: statusLabel } = syncError;

  const handleRetry = () => {
    if (isRetrying) return;
    setIsRetrying(true);
    void retry({ taskId }).finally(() => {
      // Optimistic chip-disappear happens immediately because the mutation
      // patches `lastSyncError=undefined` before the action re-runs. The
      // spinner state only matters until the mutation resolves.
      setIsRetrying(false);
    });
  };

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              aria-label="Retry GitHub sync"
              className={cn(
                "group inline-flex shrink-0 items-center gap-1.5",
                "rounded-sm border border-dashed",
                "border-amber-400/70 dark:border-amber-700",
                "bg-amber-50 dark:bg-amber-950/40",
                "px-1.5 py-0.5",
                "text-amber-800 dark:text-amber-200",
                "transition-colors",
                "hover:bg-amber-100 dark:hover:bg-amber-950/70",
                "hover:border-amber-500 dark:hover:border-amber-600",
                "disabled:opacity-60 disabled:cursor-wait",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40",
              )}
            />
          }
        >
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="font-mono text-[10px] tracking-wider uppercase leading-none">
            {statusLabel}
          </span>
          <span className="text-[10px] font-medium leading-none">
            Sync failed
          </span>
          <RotateCw
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-500",
              "group-hover:rotate-180",
              isRetrying && "animate-spin",
            )}
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              GitHub sync failed — click to retry
            </span>
            <span className="font-mono text-[10px] opacity-80 break-all">
              {message}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
