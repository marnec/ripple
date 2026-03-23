import React, { createContext, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  createCalendar,
  createViewMonthGrid,
  type CalendarEventExternal,
  type BackgroundEvent,
  type CalendarType,
  type CalendarApp,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { ScheduleXCalendar } from "@schedule-x/react";
import { Temporal } from "temporal-polyfill";
import { useQuery } from "convex/react";
import { useTheme } from "next-themes";
import { CalendarCheck, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, ListTodo, PanelRightOpen, PanelRightClose, TrendingUp } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "../../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { Id } from "../../../../convex/_generated/dataModel";
import { useCalendarInteractions, type CycleWithProgress, desktopStrategy, mobileStrategy } from "./useCalendarInteractions";
import { useCalendarSync } from "./useCalendarSync";
import { calendarDragContext } from "./calendarDragContext";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  CalendarSidebarProvider,
  CalendarSidebar,
  CalendarSidebarInset,
  CalendarSidebarHeader,
  CalendarSidebarContent,
} from "@/components/ui/calendar-sidebar";
import { estimateToDays, addCalendarDays, isDateConflict, resolveEffectiveDueDate, computeCycleAggregates } from "@/lib/calendar-utils";
import { formatDateRange, CYCLE_STATUS_STYLES } from "./cycleUtils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import "./project-calendar.css";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TAILWIND_TO_HEX: Record<string, string> = {
  "bg-gray-400": "#9ca3af",
  "bg-gray-500": "#6b7280",
  "bg-slate-400": "#94a3b8",
  "bg-slate-500": "#64748b",
  "bg-blue-400": "#60a5fa",
  "bg-blue-500": "#3b82f6",
  "bg-blue-600": "#2563eb",
  "bg-indigo-500": "#6366f1",
  "bg-violet-500": "#8b5cf6",
  "bg-purple-500": "#a855f7",
  "bg-emerald-400": "#34d399",
  "bg-emerald-500": "#10b981",
  "bg-green-500": "#22c55e",
  "bg-teal-500": "#14b8a6",
  "bg-cyan-500": "#06b6d4",
  "bg-sky-500": "#0ea5e9",
  "bg-yellow-400": "#facc15",
  "bg-yellow-500": "#eab308",
  "bg-amber-500": "#f59e0b",
  "bg-orange-500": "#f97316",
  "bg-red-500": "#ef4444",
  "bg-rose-500": "#f43f5e",
  "bg-pink-500": "#ec4899",
};

function tailwindToHex(cls: string): string {
  return TAILWIND_TO_HEX[cls] ?? "#6b7280";
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

function formatDayTitle(isoDate: string): string {
  return Temporal.PlainDate.from(isoDate).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EnrichedTask = {
  _id: string;
  title: string;
  statusId: string;
  priority: string;
  completed: boolean;
  dueDate?: string;
  plannedStartDate?: string;
  estimate?: number;
  workPeriods?: { startedAt: number; completedAt?: number }[];
  status: { color: string; name: string } | null;
};

type EventMeta = {
  statusColor: string;
  hasEstimate: boolean;
};

type TaskCalendarEvent = CalendarEventExternal & {
  readonly _meta: EventMeta;
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar ID constants — 4 visual states
// ─────────────────────────────────────────────────────────────────────────────

const CAL_NORMAL = "normal";
const CAL_NORMAL_INACTIVE = "normal-inactive";
const CAL_CONFLICT = "conflict";
const CAL_CONFLICT_INACTIVE = "conflict-inactive";

const CALENDARS_CONFIG: Record<string, CalendarType> = {
  [CAL_NORMAL]: {
    colorName: "normal",
    lightColors: { main: "#64748b", container: "#64748b35", onContainer: "#111827" },
    darkColors: { main: "#94a3b8", container: "#94a3b835", onContainer: "#f9fafb" },
  },
  [CAL_NORMAL_INACTIVE]: {
    colorName: "normal-inactive",
    lightColors: { main: "#64748b", container: "#64748b14", onContainer: "#374151" },
    darkColors: { main: "#94a3b8", container: "#94a3b814", onContainer: "#d1d5db" },
  },
  [CAL_CONFLICT]: {
    colorName: "conflict",
    lightColors: { main: "#ef4444", container: "#ef444435", onContainer: "#111827" },
    darkColors: { main: "#ef4444", container: "#ef444435", onContainer: "#f9fafb" },
  },
  [CAL_CONFLICT_INACTIVE]: {
    colorName: "conflict-inactive",
    lightColors: { main: "#ef4444", container: "#ef444414", onContainer: "#374151" },
    darkColors: { main: "#ef4444", container: "#ef444414", onContainer: "#d1d5db" },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Event builders
// ─────────────────────────────────────────────────────────────────────────────

function getTaskCalendarId(
  task: EnrichedTask,
  multiplier: 1 | 5,
  taskCycleDueDate: Map<string, string>,
): string {
  const effectiveDueDate = resolveEffectiveDueDate(task.dueDate, taskCycleDueDate.get(task._id));
  const conflict = !!effectiveDueDate && !!task.plannedStartDate &&
    isDateConflict(task.plannedStartDate, task.estimate, multiplier, effectiveDueDate);
  const hasOpenPeriod = !!task.workPeriods?.some((p) => p.completedAt === undefined);
  if (conflict) return hasOpenPeriod ? CAL_CONFLICT : CAL_CONFLICT_INACTIVE;
  return hasOpenPeriod ? CAL_NORMAL : CAL_NORMAL_INACTIVE;
}

function buildTaskEvents(
  tasks: EnrichedTask[],
  multiplier: 1 | 5 = 1,
  taskCycleDueDate: Map<string, string> = new Map(),
): TaskCalendarEvent[] {
  return tasks
    .filter((t) => !!t.plannedStartDate)
    .map((t) => {
      const days = estimateToDays(t.estimate, multiplier);
      const endDate = addCalendarDays(t.plannedStartDate!, days - 1);
      const calendarId = getTaskCalendarId(t, multiplier, taskCycleDueDate);

      const meta: EventMeta = {
        statusColor: t.status ? tailwindToHex(t.status.color) : "#6b7280",
        hasEstimate: !!t.estimate,
      };

      return {
        id: t._id,
        title: t.title,
        start: Temporal.PlainDate.from(t.plannedStartDate!),
        end: Temporal.PlainDate.from(endDate),
        calendarId,
        _meta: meta,
      } as TaskCalendarEvent;
    });
}

function buildCycleBackgroundEvents(cycles: CycleWithProgress[]): BackgroundEvent[] {
  return cycles
    .filter((c) => c.startDate && c.dueDate)
    .map((c) => ({
      start: Temporal.PlainDate.from(c.startDate!),
      end: Temporal.PlainDate.from(c.dueDate!),
      title: c.name,
      style: {
        background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
        borderLeft: "2px solid var(--color-primary)",
        opacity: "0.6",
      },
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom event content — status dot + title (draggable for rescheduling)
// ─────────────────────────────────────────────────────────────────────────────

function CustomEventContent({ calendarEvent }: { calendarEvent: any }) {
  const event = calendarEvent as TaskCalendarEvent;
  const meta: EventMeta = event._meta;
  const calendarId = calendarEvent.calendarId as string;
  return (
    <div
      className="sx-event-content cursor-grab active:cursor-grabbing"
      style={{
        backgroundColor: meta.hasEstimate ? `var(--sx-color-${calendarId}-container)` : undefined,
        borderInlineStart: `4px solid var(--sx-color-${calendarId})`,
      }}
      data-no-estimate={meta.hasEstimate ? undefined : "true"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("task-id", String(calendarEvent.id));
        e.dataTransfer.effectAllowed = "move";
        calendarDragContext.setDragTask(String(calendarEvent.id));
        const blank = document.createElement("div");
        blank.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
        document.body.appendChild(blank);
        e.dataTransfer.setDragImage(blank, 0, 0);
        requestAnimationFrame(() => blank.remove());
      }}
      onDragEnd={() => calendarDragContext.clearDragTask()}
    >
      {meta.statusColor && (
        <span
          className="sx-event-dot"
          style={{ backgroundColor: meta.statusColor }}
        />
      )}
      <span className="sx-event-title">{calendarEvent.title}</span>
    </div>
  );
}

// Stable reference — must not be defined inline in JSX. ScheduleXCalendar's
// useEffect has `customComponents` as a dependency and calls calendarApp.render()
// on change, which replays the slide-in animation on every CalendarRenderer re-render.
const CALENDAR_CUSTOM_COMPONENTS = {
  dateGridEvent: CustomEventContent,
  monthGridEvent: CustomEventContent,
  headerContent: CalendarHeaderContent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Two contexts feed CalendarHeaderContent (the schedule-x header slot):
//   CalendarHeaderConfigContext  — owned by ProjectCalendarContent (business state)
//   CalendarInternalContext      — owned by CalendarRenderer (schedule-x-bound state)
// Splitting them by ownership avoids a merged pass-through in CalendarRenderer.
// ─────────────────────────────────────────────────────────────────────────────

type CalendarHeaderConfigValue = {
  commitmentMode: boolean;
  onCommitmentModeChange: (value: boolean) => void;
  unscheduledCount: number;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
};

const CalendarHeaderConfigContext = createContext<CalendarHeaderConfigValue | null>(null);

type CalendarInternalValue = {
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  /** Bumped on every range update so the header re-reads the current date. */
  rangeVersion: number;
};

const CalendarInternalContext = createContext<CalendarInternalValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Schedule-X headerContent slot — rendered inside the calendar by schedule-x
// ─────────────────────────────────────────────────────────────────────────────

function CalendarHeaderContent() {
  const config = useContext(CalendarHeaderConfigContext);
  const internal = useContext(CalendarInternalContext);
  if (!config || !internal) return null;

  const { commitmentMode, onCommitmentModeChange, unscheduledCount, sidebarOpen, onSidebarToggle } = config;
  const { calendarControls, rangeVersion: _rangeVersion } = internal; // _rangeVersion consumed to trigger re-render on nav

  const currentLabel = (() => {
    try {
      const d = calendarControls.getDate();
      if (!d) return "";
      return d.toLocaleString("en-US", { month: "long", year: "numeric" });
    } catch {
      return "";
    }
  })();

  return (
    <div className="flex items-center justify-between w-full gap-2 px-1">
      {/* Left: nav + current month label */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const d = calendarControls.getDate();
            calendarControls.setDate(d.subtract({ months: 1 }));
          }}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const d = calendarControls.getDate();
            calendarControls.setDate(d.add({ months: 1 }));
          }}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium tabular-nums min-w-30">
          {currentLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => calendarControls.setDate(Temporal.Now.plainDateISO())}
          aria-label="Today"
        >
          <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Today</span>
        </Button>
      </div>

      {/* Right: Planned/Commitment toggle + Unscheduled sidebar button */}
      <div className="flex items-center gap-2">
        {/* Planned / Commitment toggle */}
        <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              !commitmentMode
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onCommitmentModeChange(false)}
            aria-label="Planned"
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Planned</span>
          </button>
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              commitmentMode
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onCommitmentModeChange(true)}
            aria-label="Commitment"
          >
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Commitment</span>
          </button>
        </div>

        {/* Unscheduled sidebar toggle — desktop only */}
        <Button
          variant="outline"
          size="sm"
          onClick={onSidebarToggle}
          disabled={unscheduledCount === 0 && !sidebarOpen}
          className="hidden md:flex h-7 text-xs"
        >
          {sidebarOpen ? (
            <PanelRightClose className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <PanelRightOpen className="h-3.5 w-3.5 mr-1.5" />
          )}
          <ListTodo className="h-3.5 w-3.5 mr-1" />
          Unscheduled {unscheduledCount > 0 && `(${unscheduledCount})`}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarGhostOverlay — Framer Motion drag preview that springs between days
// ─────────────────────────────────────────────────────────────────────────────

type GhostPos = { top: number; left: number; width: number; height: number };

function resolveGhostPosition({
  calendarRoot,
  date,
  spanDays,
}: {
  calendarRoot: Element | null;
  date: string;
  spanDays: number;
}): GhostPos | null {
  if (!calendarRoot) return null;
  const dayEl = calendarRoot.querySelector(`[data-date="${date}"]`);
  if (!dayEl) return null;
  const dayRect = dayEl.getBoundingClientRect();

  let topOffset = 24;
  let eventHeight = 22;
  const refEvent = calendarRoot.querySelector(".sx__month-grid-event");
  const refCell = refEvent?.closest("[data-date]");
  if (refEvent && refCell) {
    const eventRect = refEvent.getBoundingClientRect();
    const cellRect = refCell.getBoundingClientRect();
    topOffset = Math.round(eventRect.top - cellRect.top);
    eventHeight = Math.round(eventRect.height);
  }

  let width = dayRect.width - 4;
  if (spanDays > 1) {
    const endDate = addCalendarDays(date, spanDays - 1);
    const endEl = calendarRoot.querySelector(`[data-date="${endDate}"]`);
    if (endEl) {
      const endRect = endEl.getBoundingClientRect();
      if (Math.abs(endRect.top - dayRect.top) < 10) {
        width = endRect.right - dayRect.left - 4;
      }
    }
  }

  return { top: dayRect.top + topOffset, left: dayRect.left + 2, width, height: eventHeight };
}

function CalendarGhostOverlay({
  task,
  hoveredDropDate,
  multiplier,
  calendarId,
  wrapperRef,
}: {
  task: EnrichedTask;
  hoveredDropDate: string;
  multiplier: 1 | 5;
  calendarId: string;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<GhostPos | null>(null);

  useLayoutEffect(() => {
    const spanDays = estimateToDays(task.estimate, multiplier);
    setPos(resolveGhostPosition({ calendarRoot: wrapperRef.current, date: hoveredDropDate, spanDays }));
  }, [wrapperRef, hoveredDropDate, task.estimate, multiplier]);

  const statusColor = task.status ? tailwindToHex(task.status.color) : "#6b7280";
  const hasEstimate = !!task.estimate;

  return (
    <AnimatePresence>
      {pos && (
        <motion.div
          key="ghost"
          style={{
            position: "fixed",
            height: pos.height,
            zIndex: 1000,
            overflow: "hidden",
            pointerEvents: "none",
            borderRadius: "3px",
          }}
          initial={{ opacity: 0, top: pos.top, left: pos.left, width: pos.width }}
          animate={{ opacity: 0.75, top: pos.top, left: pos.left, width: pos.width }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 0.5 }}
        >
          <div
            className="sx-event-content"
            style={{
              backgroundColor: hasEstimate ? `var(--sx-color-${calendarId}-container)` : undefined,
              borderInlineStart: `4px solid var(--sx-color-${calendarId})`,
              ...(hasEstimate ? {} : {
                borderTop: "1px dashed currentColor",
                borderRight: "1px dashed currentColor",
                borderBottom: "1px dashed currentColor",
                borderRadius: "3px",
                opacity: 0.75,
              }),
            }}
          >
            <span className="sx-event-dot" style={{ backgroundColor: statusColor }} />
            <span className="sx-event-title">{task.title}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route entry
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectCalendar() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectCalendarContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

function ProjectCalendarContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const calendarWrapperRef = useRef<HTMLDivElement>(null);
  const tasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const calendarData = useQuery(api.cycles.listForCalendar, { projectId });
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const isDark = resolvedTheme === "dark";

  const cycles = calendarData?.cycles as CycleWithProgress[] | undefined;

  const strategy = isMobile ? mobileStrategy : desktopStrategy;
  const ix = useCalendarInteractions({
    strategy,
    cycles,
    dragContext: calendarDragContext,
  });

  const cycleTasks = useQuery(
    api.cycles.listCycleTasks,
    ix.cycleSheet.cycle ? { cycleId: ix.cycleSheet.cycle._id as Id<"cycles"> } : "skip",
  );

  const multiplier: 1 | 5 = ix.commitmentMode ? 5 : 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTasks = (tasks ?? []) as EnrichedTask[];

  const unscheduledTasks: EnrichedTask[] = allTasks
    .filter((t) => !t.completed && t.plannedStartDate === undefined)
    .sort((a, b) => {
      const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
    });

  const taskCycleDueDate = new Map<string, string>(
    (calendarData?.taskCycleDueDatePairs ?? []).map(({ taskId, cycleDueDate }) => [taskId, cycleDueDate])
  );

  const { draggedTaskId, hoveredDropDate, pendingSchedule, clearPendingSchedule } = ix.dragDrop;

  // Resolve the task being dragged (scheduled or unscheduled) for the ghost overlay.
  const draggedTask =
    draggedTaskId
      ? (allTasks.find((t) => t._id === draggedTaskId) ??
         unscheduledTasks.find((t) => t._id === draggedTaskId) ??
         null)
      : null;

  // Clear the optimistic pending schedule once Convex data has caught up.
  useEffect(() => {
    if (!pendingSchedule) return;
    const task = allTasks.find((t) => t._id === pendingSchedule.taskId);
    if (task && task.plannedStartDate === pendingSchedule.date) {
      clearPendingSchedule();
    }
  }, [allTasks, pendingSchedule, clearPendingSchedule]);

  // Build base events:
  //  - During drag: exclude the dragged task (overlay ghost replaces it)
  //  - After drop: apply pending schedule optimistically until server round-trip
  const tasksForEvents = allTasks
    .filter((t) => t._id !== draggedTaskId)
    .map((t) =>
      pendingSchedule?.taskId === t._id
        ? { ...t, plannedStartDate: pendingSchedule.date }
        : t,
    );

  const baseTaskEvents = buildTaskEvents(tasksForEvents, multiplier, taskCycleDueDate);

  // For a previously-unscheduled task being optimistically shown after drop:
  // it won't be in allTasks yet, so synthesize its event from the unscheduled list.
  const pendingUnscheduledEvents: TaskCalendarEvent[] = (() => {
    if (!pendingSchedule) return [];
    if (allTasks.some((t) => t._id === pendingSchedule.taskId)) return [];
    const task = unscheduledTasks.find((t) => t._id === pendingSchedule.taskId);
    if (!task) return [];
    return buildTaskEvents(
      [{ ...task, plannedStartDate: pendingSchedule.date }],
      multiplier,
      taskCycleDueDate,
    );
  })();

  const taskEvents = [...baseTaskEvents, ...pendingUnscheduledEvents];
  const bgEvents = buildCycleBackgroundEvents(cycles ?? []);
  const hasScheduledTasks = allTasks.some((t) => !!t.plannedStartDate);

  return (
    <CalendarHeaderConfigContext.Provider value={{
      commitmentMode: ix.commitmentMode,
      onCommitmentModeChange: ix.setCommitmentMode,
      unscheduledCount: unscheduledTasks.length,
      sidebarOpen: ix.sidebar.open,
      onSidebarToggle: ix.sidebar.toggle,
    }}>
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 md:px-6 md:pt-6 pb-4 gap-2">
      {/* Main area: calendar + right push sidebar (desktop only) */}
      <CalendarSidebarProvider
        open={ix.sidebar.open}
        onOpenChange={ix.sidebar.onOpenChange}
        className="flex-1 min-h-0"
      >
        <CalendarSidebarInset
          onDragOver={ix.dragDrop.onDragOver}
          onDragLeave={ix.dragDrop.onDragLeave}
          onDrop={ix.dragDrop.onDrop}
        >
          <CalendarRenderer
            key={String(isDark)}
            taskEvents={taskEvents}
            bgEvents={bgEvents}
            defaultView="month-grid"
            isDark={isDark}
            onEventClick={ix.onEventClick}
            onClickDate={ix.onClickDate}
            onClickCycle={ix.cycleSheet.onCycleClick}
            wrapperRef={calendarWrapperRef}
          />
          {tasks !== undefined && !hasScheduledTasks && <EmptyCalendarOverlay />}
        </CalendarSidebarInset>

        {/* Animated ghost overlay — rendered outside the inset so it can use
            position:fixed and escape any overflow clipping. */}
        <AnimatePresence>
          {draggedTask && hoveredDropDate && (
            <CalendarGhostOverlay
              key={draggedTask._id}
              task={draggedTask}
              hoveredDropDate={hoveredDropDate}
              multiplier={multiplier}
              calendarId={getTaskCalendarId(draggedTask, multiplier, taskCycleDueDate)}
              wrapperRef={calendarWrapperRef}
            />
          )}
        </AnimatePresence>

        <CalendarSidebar side="right" className="hidden md:flex">
          <CalendarSidebarHeader>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Unscheduled
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {unscheduledTasks.length}
              </span>
            </div>
          </CalendarSidebarHeader>
          <CalendarSidebarContent>
            <UnscheduledTaskList tasks={unscheduledTasks} />
          </CalendarSidebarContent>
        </CalendarSidebar>
      </CalendarSidebarProvider>

      {/* Mobile task action drawer */}
      {ix.taskFocus?.surface === "drawer" && (
        <MobileTaskActionDrawer
          taskId={ix.taskFocus.taskId}
          task={allTasks.find((t) => t._id === ix.taskFocus?.taskId) ?? null}
          open={true}
          onOpenChange={(open) => { if (!open) ix.clearTaskFocus(); }}
          onUnschedule={() => {
            if (ix.taskFocus?.surface === "drawer") ix.unscheduleTask(ix.taskFocus.taskId);
            ix.clearTaskFocus();
          }}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      )}

      {/* Desktop task detail sheet */}
      <Suspense fallback={null}>
        <LazyTaskDetailSheet
          taskId={ix.taskFocus?.surface === "sheet" ? ix.taskFocus.taskId : null}
          open={ix.taskFocus?.surface === "sheet"}
          onOpenChange={(open) => { if (!open) ix.clearTaskFocus(); }}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      </Suspense>

      {/* Mobile: day-tap bottom drawer */}
      <DayScheduleDrawer
        date={ix.dayFocus?.surface === "drawer" ? ix.dayFocus.date : null}
        open={ix.dayFocus?.surface === "drawer"}
        onOpenChange={(open) => { if (!open) ix.clearDayFocus(); }}
        allTasks={allTasks}
        unscheduledTasks={unscheduledTasks}
        onSchedule={ix.scheduleTask}
        onUnschedule={ix.unscheduleTask}
      />

      <CycleDetailSheet
        cycle={ix.cycleSheet.cycle}
        tasks={cycleTasks as EnrichedTask[] | undefined}
        onClose={ix.cycleSheet.onClose}
      />
    </div>
    </CalendarHeaderConfigContext.Provider>
  );
}
ProjectCalendarContent.whyDidYouRender = true;

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: draggable unscheduled task list
// ─────────────────────────────────────────────────────────────────────────────

function UnscheduledTaskList({ tasks }: { tasks: EnrichedTask[] }) {
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
// Mobile: task-tap action drawer
// ─────────────────────────────────────────────────────────────────────────────

function MobileTaskActionDrawer({
  taskId,
  task,
  open,
  onOpenChange,
  onUnschedule,
  workspaceId,
  projectId,
}: {
  taskId: Id<"tasks"> | null;
  task: EnrichedTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnschedule: () => void;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const navigate = useNavigate();

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-base truncate">{task?.title ?? ""}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-4 pb-6 pb-safe">
          <Button
            variant="ghost"
            className="justify-start h-11 text-sm"
            onClick={() => {
              onOpenChange(false);
              void navigate(
                `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`
              );
            }}
          >
            View task details
          </Button>
          <Button
            variant="ghost"
            className="justify-start h-11 text-sm text-muted-foreground"
            onClick={onUnschedule}
          >
            Unschedule
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile: day-tap bottom drawer with schedule checklist
// ─────────────────────────────────────────────────────────────────────────────

function DayScheduleDrawer({
  date,
  open,
  onOpenChange,
  allTasks,
  unscheduledTasks,
  onSchedule,
  onUnschedule,
}: {
  date: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTasks: EnrichedTask[];
  unscheduledTasks: EnrichedTask[];
  onSchedule: (taskId: Id<"tasks">, date: string) => void;
  onUnschedule: (taskId: Id<"tasks">) => void;
}) {
  if (!date) return null;

  const scheduledToday = allTasks.filter(
    (t) => t.plannedStartDate === date && !t.completed,
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="max-h-[70vh]">
        <DrawerHeader>
          <DrawerTitle>{formatDayTitle(date)}</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto pb-safe">
          {scheduledToday.length > 0 && (
            <section className="px-4 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Scheduled
              </p>
              <div className="space-y-0.5">
                {scheduledToday.map((task) => (
                  <DayTaskRow
                    key={task._id}
                    task={task}
                    checked
                    onToggle={() => onUnschedule(task._id as Id<"tasks">)}
                  />
                ))}
              </div>
            </section>
          )}
          {unscheduledTasks.length > 0 && (
            <section className="px-4 pb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Unscheduled
              </p>
              <div className="space-y-0.5">
                {unscheduledTasks.map((task) => (
                  <DayTaskRow
                    key={task._id}
                    task={task}
                    checked={false}
                    onToggle={() => onSchedule(task._id as Id<"tasks">, date)}
                  />
                ))}
              </div>
            </section>
          )}
          {scheduledToday.length === 0 && unscheduledTasks.length === 0 && (
            <p className="px-4 pb-6 text-sm text-muted-foreground text-center">
              No tasks
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DayTaskRow({
  task,
  checked,
  onToggle,
}: {
  task: EnrichedTask;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 px-1 py-2 rounded hover:bg-muted cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: PRIORITY_COLORS[task.priority] ?? "#6b7280" }}
      />
      <span className="text-sm truncate">{task.title}</span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarRenderer — stable calendarApp instance per key
// ─────────────────────────────────────────────────────────────────────────────

const BG_EVENT_SELECTOR = [
  ".sx__date-grid-background-event",
  ".sx__month-grid-background-event",
  ".sx__time-grid-background-event",
].join(", ");

function CalendarRenderer({
  taskEvents,
  bgEvents,
  defaultView,
  isDark,
  onEventClick,
  onClickDate,
  onClickCycle,
  wrapperRef,
}: {
  taskEvents: TaskCalendarEvent[];
  bgEvents: BackgroundEvent[];
  defaultView: string;
  isDark: boolean;
  onEventClick: (id: string | number) => void;
  onClickDate?: (date: string) => void;
  onClickCycle?: (name: string) => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Stable ref so the event listener never needs to be re-registered.
  const onClickCycleRef = useRef(onClickCycle);
  useEffect(() => { onClickCycleRef.current = onClickCycle; });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    function handleClick(e: MouseEvent) {
      const bgEl = (e.target as HTMLElement).closest(BG_EVENT_SELECTOR);
      if (!bgEl) return;
      e.stopPropagation();
      onClickCycleRef.current?.(bgEl.getAttribute("title") ?? "");
    }
    wrapper.addEventListener("click", handleClick, true);
    return () => wrapper.removeEventListener("click", handleClick, true);
  }, [wrapperRef]);
  const [rangeVersion, setRangeVersion] = useState(0);

  const [calendarControls] = useState(() => createCalendarControlsPlugin());

  const [calendarApp] = useState<CalendarApp>(() =>
    createCalendar({
      views: [createViewMonthGrid()],
      defaultView,
      events: taskEvents,
      backgroundEvents: bgEvents,
      calendars: CALENDARS_CONFIG,
      isDark,
      theme: "shadcn",
      plugins: [calendarControls],
      callbacks: {
        onEventClick(event) {
          onEventClick(event.id);
        },
        onClickDate(date: string) {
          onClickDate?.(date);
        },
        onRangeUpdate() {
          setRangeVersion((v) => v + 1);
        },
      },
    }),
  );

  // Fade the view container on range change (anti-FOUC).
  useEffect(() => {
    if (rangeVersion === 0) return;
    const vc = wrapperRef.current?.querySelector<HTMLElement>(".sx__view-container");
    if (!vc) return;
    vc.style.opacity = "0";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        vc.style.opacity = "";
      });
    });
  }, [rangeVersion, wrapperRef]);

  useCalendarSync(calendarApp, taskEvents, bgEvents);

  return (
    <CalendarInternalContext.Provider value={{ calendarControls, rangeVersion }}>
      <div style={{ height: "100%" }} ref={wrapperRef}>
        <ScheduleXCalendar
          calendarApp={calendarApp}
          customComponents={CALENDAR_CUSTOM_COMPONENTS}
        />
      </div>
    </CalendarInternalContext.Provider>
  );
}
CalendarRenderer.whyDidYouRender = true;

// ─────────────────────────────────────────────────────────────────────────────
// Empty state overlay
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Cycle detail sheet
// ─────────────────────────────────────────────────────────────────────────────

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

function CycleDetailSheet({
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

// ─────────────────────────────────────────────────────────────────────────────

function EmptyCalendarOverlay() {
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
