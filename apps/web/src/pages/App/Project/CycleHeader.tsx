import { Button } from "@ripple/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Flag, MoreHorizontal, Pencil, Plus, RotateCcw, Star } from "lucide-react";
import type { CycleStatus } from "@ripple/shared/types/cycles";
import { cycleBadge, formatDateRange, daysRemaining } from "./cycleUtils";

interface CycleHeaderProps {
  cycle: {
    name: string;
    status: CycleStatus;
    isCurrent: boolean;
    totalTasks: number;
    completedTasks: number;
    progressPercent: number;
    startDate?: string;
    dueDate?: string;
  };
  onEdit: () => void;
  onAddTasks: () => void;
  onClose: () => void;
  onReopen: () => void;
  onSetCurrent: () => void;
}

export function CycleHeader({
  cycle,
  onEdit,
  onAddTasks,
  onClose,
  onReopen,
  onSetCurrent,
}: CycleHeaderProps) {
  const badge = cycleBadge(cycle);
  const isOpen = cycle.status === "open";
  const dateRange = formatDateRange(cycle.startDate, cycle.dueDate);
  const remaining = isOpen ? daysRemaining(cycle.dueDate) : null;

  return (
    <div className="px-4 py-2.5 md:px-8 border-b">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{cycle.name}</h2>
          <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0", badge.badge)}>
            {badge.label}
          </span>
          {remaining !== null && remaining >= 0 && (
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
              {remaining === 0 ? "target today" : `${remaining}d to target`}
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

        {isOpen ? (
          <>
            <Button variant="outline" size="sm" onClick={onAddTasks} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Add tasks</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onClose} className="shrink-0">
              <Flag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Close cycle</span>
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onReopen} className="shrink-0">
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reopen</span>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="More cycle actions" />}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit} className="flex items-center gap-2">
              <Pencil className="size-3.5" />
              Edit
            </DropdownMenuItem>
            {isOpen && !cycle.isCurrent && (
              <DropdownMenuItem onClick={onSetCurrent} className="flex items-center gap-2">
                <Star className="size-3.5" />
                Make current
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
