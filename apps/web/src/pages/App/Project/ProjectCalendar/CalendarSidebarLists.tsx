import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { Switch } from "@/components/ui/switch";
import { calendarDragContext } from "../calendarDragContext";
import {
  type EnrichedTask,
  PRIORITY_COLORS,
  tailwindToHex,
  hasActualData,
} from "./calendar-events";

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: draggable unscheduled task list
// ─────────────────────────────────────────────────────────────────────────────

export function UnscheduledTaskList({ tasks }: { tasks: EnrichedTask[] }) {
  return (
    <div className="p-2 space-y-0.5">
      {tasks.map((task) => (
        <UnscheduledTaskItem key={task._id} task={task} />
      ))}
    </div>
  );
}

function UnscheduledTaskItem({ task }: { task: EnrichedTask }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("task-id", task._id);
        e.dataTransfer.effectAllowed = "move";
        calendarDragContext.setDragTask(task._id);
        const ghost = document.createElement("div");
        ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => ghost.remove());
      }}
      onDragEnd={() => calendarDragContext.clearDragTask()}
      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted cursor-grab active:cursor-grabbing select-none"
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: PRIORITY_COLORS[task.priority] ?? "#6b7280" }}
      />
      <span className="truncate text-foreground">{task.title}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop sidebar: scheduled tasks with actual-time toggles
// ─────────────────────────────────────────────────────────────────────────────

export const ACTUAL_TIME_HINT =
  "Overlays the hours actually logged against each task on the calendar, alongside its planned block.";

export function ScheduledSectionHeader({
  tasks,
  monthLabel,
  visibleActualTaskIds,
  onSetAll,
  onClearAll,
}: {
  tasks: EnrichedTask[];
  /** e.g. "Aug 2026" — null until schedule-x has reported a range. */
  monthLabel: string | null;
  visibleActualTaskIds: Set<string>;
  onSetAll: (ids: string[]) => void;
  onClearAll: () => void;
}) {
  const togglable = tasks.filter(hasActualData);
  const allOn = togglable.length > 0 && togglable.every((t) => visibleActualTaskIds.has(t._id));

  return (
    <div className="space-y-1">
      {/* The list is scoped to the month on screen, so the heading has to name
          it — otherwise the count silently changes under month navigation and
          reads as tasks disappearing. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
          {monthLabel ? `Scheduled · ${monthLabel}` : "Scheduled"}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{tasks.length}</span>
      </div>
      {/* The switch column needs a name. Unlabelled it is unreadable — nothing
          on the row says the toggle is about logged time rather than, say,
          hiding the task from the grid. */}
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-[11px] text-muted-foreground cursor-help decoration-dotted underline underline-offset-2" />
            }
          >
            Show actual time
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56">
            {ACTUAL_TIME_HINT}
          </TooltipContent>
        </Tooltip>
        {togglable.length > 0 && (
          <Switch
            checked={allOn}
            onCheckedChange={(checked) =>
              checked ? onSetAll(togglable.map((t) => t._id)) : onClearAll()
            }
            aria-label="Show actual time for every task scheduled this month"
          />
        )}
      </div>
    </div>
  );
}

export function ScheduledTaskList({
  tasks,
  monthLabel,
  visibleActualTaskIds,
  onToggle,
}: {
  tasks: EnrichedTask[];
  monthLabel: string | null;
  visibleActualTaskIds: Set<string>;
  onToggle: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        {monthLabel ? `Nothing scheduled in ${monthLabel}` : "No scheduled tasks"}
      </p>
    );
  }
  return (
    <div className="p-2 space-y-0.5">
      {tasks.map((task) => (
        <ScheduledTaskItem
          key={task._id}
          task={task}
          isVisible={visibleActualTaskIds.has(task._id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function ScheduledTaskItem({
  task,
  isVisible,
  onToggle,
}: {
  task: EnrichedTask;
  isVisible: boolean;
  onToggle: (taskId: string) => void;
}) {
  const canToggle = hasActualData(task);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted select-none">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: task.status ? tailwindToHex(task.status.color) : "#6b7280" }}
      />
      <span className="truncate text-foreground flex-1">{task.title}</span>
      {/* A disabled switch with no explanation reads as broken; say why. */}
      <span title={canToggle ? undefined : "No time logged on this task yet"}>
        <Switch
          checked={isVisible && canToggle}
          disabled={!canToggle}
          onCheckedChange={() => onToggle(task._id)}
          aria-label={`Show actual time for ${task.title}`}
        />
      </span>
    </div>
  );
}
