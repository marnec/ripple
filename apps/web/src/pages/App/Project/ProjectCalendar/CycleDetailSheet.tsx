import { CalendarDays, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeCycleAggregates } from "@/lib/calendar-utils";
import type { CycleWithProgress } from "../useCalendarInteractions";
import { formatDateRange, CYCLE_STATUS_STYLES } from "../cycleUtils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EnrichedTask } from "./calendar-events";

function HofstadterTable({ tasks }: { tasks: { estimate?: number }[] }) {
  const agg = computeCycleAggregates(tasks);
  const fmt = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Raw</span>
        <span className="tabular-nums text-right">{fmt(agg.totalHours)}</span>
        <span />
        <span className="text-muted-foreground">Planned</span>
        <span className="tabular-nums text-right">{fmt(agg.planHours)}</span>
        <span className="text-xs text-muted-foreground">×1.6</span>
        <span className="text-muted-foreground">Commit</span>
        <span className="tabular-nums text-right">{fmt(agg.commitHours)}</span>
        <span className="text-xs text-muted-foreground">×5</span>
      </div>
      {agg.unestimatedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {agg.unestimatedCount} task{agg.unestimatedCount === 1 ? "" : "s"} without estimate
        </p>
      )}
      {agg.totalHours === 0 && agg.unestimatedCount === 0 && (
        <p className="text-xs text-muted-foreground">No tasks in this cycle yet.</p>
      )}
    </div>
  );
}

export function CycleDetailSheet({
  cycle,
  tasks,
  onClose,
}: {
  cycle: CycleWithProgress | null;
  tasks: EnrichedTask[] | undefined;
  onClose: () => void;
}) {
  const statusStyle = cycle ? CYCLE_STATUS_STYLES[cycle.status] : null;
  return (
    <Sheet open={cycle !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-xs flex flex-col gap-0 p-0">
        {cycle && (
          <>
            <SheetHeader className="p-4 pb-3 border-b">
              <div className="flex items-center gap-2 pr-8">
                <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <SheetTitle className="text-base truncate">{cycle.name}</SheetTitle>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {formatDateRange(cycle.startDate, cycle.dueDate)}
                </span>
                {statusStyle && (
                  <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium capitalize", statusStyle.badge)}>
                    {cycle.status}
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
              {/* Progress */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Progress
                  </span>
                  <span className="text-xs tabular-nums">{cycle.progressPercent}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${cycle.progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {cycle.completedTasks} of {cycle.totalTasks} tasks complete
                </p>
              </section>

              {/* Hofstadter aggregates */}
              <section>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Estimates
                </p>
                {tasks === undefined
                  ? <div className="h-16" />
                  : <HofstadterTable tasks={tasks} />
                }
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function EmptyCalendarOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-2 text-center bg-background/80 backdrop-blur-sm rounded-lg px-6 py-4 pointer-events-auto">
        <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No scheduled tasks</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Set a planned start date on tasks to see them here.
        </p>
      </div>
    </div>
  );
}
