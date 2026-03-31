import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pencil, Plus } from "lucide-react";
import type { CycleStatus } from "@shared/types/cycles";
import { CYCLE_STATUS_STYLES, formatDateRange, daysRemaining } from "./cycleUtils";

interface CycleHeaderProps {
  cycle: {
    name: string;
    status: string;
    totalTasks: number;
    completedTasks: number;
    progressPercent: number;
    startDate?: string;
    dueDate?: string;
  };
  onEdit: () => void;
  onAddTasks: () => void;
}

export function CycleHeader({ cycle, onEdit, onAddTasks }: CycleHeaderProps) {
  const cycleStatus = cycle.status as CycleStatus;
  const styles = CYCLE_STATUS_STYLES[cycleStatus] ?? CYCLE_STATUS_STYLES.draft;
  const dateRange = formatDateRange(cycle.startDate, cycle.dueDate);
  const remaining = daysRemaining(cycle.dueDate);

  return (
    <div className="px-4 py-2.5 md:px-8 border-b">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{cycle.name}</h2>
          <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0", styles.badge)}>
            {cycle.status}
          </span>
          {remaining !== null && remaining >= 0 && (
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
              {remaining === 0 ? "ends today" : `${remaining}d left`}
            </span>
          )}
          {dateRange && (
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{dateRange}</span>
          )}
          {cycle.totalTasks > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${cycle.progressPercent}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {cycle.completedTasks}/{cycle.totalTasks}
              </span>
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={onAddTasks} className="shrink-0">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add tasks</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} className="shrink-0">
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Edit</span>
        </Button>
      </div>
    </div>
  );
}
