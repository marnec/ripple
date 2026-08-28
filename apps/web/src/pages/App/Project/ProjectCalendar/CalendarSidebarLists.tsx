import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { Switch } from "@/components/ui/switch";
import { calendarDragContext } from "../calendarDragContext";
import {
  type EnrichedTask,
  type VisibleMonth,
  PRIORITY_COLORS,
  tailwindToHex,
  hasActualData,
  actualSpan,
  formatActualSpan,
  spanInMonth,
} from "./calendar-events";

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: draggable unscheduled task list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared by the calendar sidebar and the gantt pool — the two headers were
 * duplicated character-for-character before the hint went in.
 *
 * The hint is the whole point of the section: the only way to schedule from
 * here is a drag, and nothing about a plain list says so. It names the drop
 * target, which differs per view, and disappears once the pool is empty —
 * there is nothing left to drag, so the instruction is just noise.
 */
export function UnscheduledSectionHeader({
  count,
  hint,
}: {
  count: number;
  hint: string;
}) {
  return (
    <div className="space-y-0.5 mt-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Unscheduled
        </span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{count}</span>
      </div>
      {count > 0 && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

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
  visibleMonth,
  visibleActualTaskIds,
  onToggle,
  onGoToDate,
}: {
  tasks: EnrichedTask[];
  monthLabel: string | null;
  visibleMonth: VisibleMonth | null;
  visibleActualTaskIds: Set<string>;
  onToggle: (taskId: string) => void;
  /** Navigate the grid to the month containing an ISO date. */
  onGoToDate: (isoDate: string) => void;
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
          visibleMonth={visibleMonth}
          onToggle={onToggle}
          onGoToDate={onGoToDate}
        />
      ))}
    </div>
  );
}

function ScheduledTaskItem({
  task,
  isVisible,
  visibleMonth,
  onToggle,
  onGoToDate,
}: {
  task: EnrichedTask;
  isVisible: boolean;
  visibleMonth: VisibleMonth | null;
  onToggle: (taskId: string) => void;
  onGoToDate: (isoDate: string) => void;
}) {
  const canToggle = hasActualData(task);
  const span = actualSpan(task);
  // Logged time is independent of the planned date, so a task listed under
  // August can have its overlay drawn in April. Switching it on would then
  // change nothing on screen and read as a dead control — so once it is on,
  // the row says where the overlay actually is, and offers to go there.
  const offMonth =
    isVisible && span !== null && visibleMonth !== null
      ? !spanInMonth(span.start, span.end, visibleMonth)
      : false;

  return (
    <div className="rounded hover:bg-muted select-none">
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
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
      {isVisible && canToggle && span && (
        <div className="flex items-center gap-1.5 pl-5.5 pr-2 pb-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">Logged {formatActualSpan(span)}</span>
          {offMonth && (
            <button
              className="shrink-0 underline underline-offset-2 hover:text-foreground"
              onClick={() => onGoToDate(span.start)}
            >
              Show
            </button>
          )}
        </div>
      )}
    </div>
  );
}
