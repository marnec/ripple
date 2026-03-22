import React, { Suspense, useEffect, useRef, useState } from "react";
import {
  createCalendar,
  createViewMonthGrid,
  type CalendarEventExternal,
  type BackgroundEvent,
  type CalendarType,
  type CalendarApp,
} from "@schedule-x/calendar";
import { ScheduleXCalendar } from "@schedule-x/react";
import { Temporal } from "temporal-polyfill";
import { useQuery } from "convex/react";
import { useTheme } from "next-themes";
import { CalendarDays, ListTodo, PanelRightOpen, PanelRightClose, TrendingUp } from "lucide-react";
import { useParams } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "../../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { Id } from "../../../../convex/_generated/dataModel";
import { useCalendarInteractions, type CycleWithProgress } from "./useCalendarInteractions";
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

const LazyCreateTaskDialog = React.lazy(() =>
  import("./CreateTaskDialog").then((m) => ({ default: m.CreateTaskDialog })),
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

function buildTaskEvents(
  tasks: EnrichedTask[],
  multiplier: 1 | 5 = 1,
  taskCycleDueDate: Map<string, string> = new Map(),
): CalendarEventExternal[] {
  return tasks
    .filter((t) => !!t.plannedStartDate)
    .map((t) => {
      const days = estimateToDays(t.estimate, multiplier);
      const endDate = addCalendarDays(t.plannedStartDate!, days - 1);
      const effectiveDueDate = resolveEffectiveDueDate(t.dueDate, taskCycleDueDate.get(t._id));
      const conflict = !!effectiveDueDate && isDateConflict(t.plannedStartDate!, t.estimate, multiplier, effectiveDueDate);
      const hasOpenPeriod = !!t.workPeriods?.some((p) => p.completedAt === undefined);

      let calendarId: string;
      if (conflict) {
        calendarId = hasOpenPeriod ? CAL_CONFLICT : CAL_CONFLICT_INACTIVE;
      } else {
        calendarId = hasOpenPeriod ? CAL_NORMAL : CAL_NORMAL_INACTIVE;
      }

      const meta: EventMeta = {
        statusColor: t.status ? tailwindToHex(t.status.color) : "#6b7280",
        hasEstimate: !!t.estimate,
      };

      const event = {
        id: t._id,
        title: t.title,
        start: Temporal.PlainDate.from(t.plannedStartDate!),
        end: Temporal.PlainDate.from(endDate),
        calendarId,
      } as CalendarEventExternal;

      (event as any)._meta = meta;
      return event;
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

function CustomEventContent({ calendarEvent, hasStartDate }: { calendarEvent: any; hasStartDate?: boolean }) {
  const meta = calendarEvent._meta as EventMeta | undefined;
  const calendarId = calendarEvent.calendarId as string;
  return (
    <div
      className="sx-event-content"
      style={{
        backgroundColor: meta?.hasEstimate ? `var(--sx-color-${calendarId}-container)` : undefined,
        borderInlineStart: (meta?.hasEstimate && hasStartDate) ? `4px solid var(--sx-color-${calendarId}-main)` : undefined,
      }}
      data-no-estimate={meta?.hasEstimate ? undefined : "true"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("task-id", String(calendarEvent.id));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {meta?.statusColor && (
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar header
// ─────────────────────────────────────────────────────────────────────────────

function CalendarHeader({
  commitmentMode,
  onCommitmentModeChange,
  unscheduledCount,
  sidebarOpen,
  onSidebarToggle,
}: {
  commitmentMode: boolean;
  onCommitmentModeChange: (value: boolean) => void;
  unscheduledCount: number;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between shrink-0 gap-2">
      {/* Planned / Commitment toggle */}
      <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
        <button
          className={`px-2.5 py-1 rounded transition-colors ${
            !commitmentMode
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onCommitmentModeChange(false)}
        >
          Planned
        </button>
        <button
          className={`px-2.5 py-1 rounded transition-colors ${
            commitmentMode
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onCommitmentModeChange(true)}
        >
          Commitment
        </button>
      </div>

      {/* Unscheduled sidebar toggle — desktop only */}
      <Button
        variant="outline"
        size="sm"
        onClick={onSidebarToggle}
        disabled={unscheduledCount === 0 && !sidebarOpen}
        className="hidden md:flex"
      >
        {sidebarOpen ? (
          <PanelRightClose className="h-4 w-4 mr-1.5" />
        ) : (
          <PanelRightOpen className="h-4 w-4 mr-1.5" />
        )}
        <ListTodo className="h-4 w-4 mr-1" />
        Unscheduled {unscheduledCount > 0 && `(${unscheduledCount})`}
      </Button>
    </div>
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
  const tasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const unscheduled = useQuery(api.tasks.listUnscheduled, { projectId });
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const taskCycleDueDatePairs = useQuery(api.cycles.listTaskCycleDueDates, { projectId });
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const isDark = resolvedTheme === "dark";

  const ix = useCalendarInteractions({
    isMobile,
    cycles: cycles as CycleWithProgress[] | undefined,
  });

  const cycleTasks = useQuery(
    api.cycles.listCycleTasks,
    ix.cycleSheet.cycle ? { cycleId: ix.cycleSheet.cycle._id as Id<"cycles"> } : "skip",
  );

  const multiplier: 1 | 5 = ix.commitmentMode ? 5 : 1;
  const allTasks = (tasks ?? []) as EnrichedTask[];
  const taskCycleDueDate = new Map(
    (taskCycleDueDatePairs ?? []).map(({ taskId, cycleDueDate }) => [taskId, cycleDueDate])
  );
  const taskEvents = buildTaskEvents(allTasks, multiplier, taskCycleDueDate);
  const bgEvents = buildCycleBackgroundEvents((cycles ?? []) as CycleWithProgress[]);
  const hasScheduledTasks = allTasks.some((t) => !!t.plannedStartDate);
  const unscheduledTasks = (unscheduled ?? []) as EnrichedTask[];

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 md:px-6 md:pt-6 pb-4 gap-2">
      <CalendarHeader
        commitmentMode={ix.commitmentMode}
        onCommitmentModeChange={ix.setCommitmentMode}
        unscheduledCount={unscheduledTasks.length}
        sidebarOpen={ix.sidebar.open}
        onSidebarToggle={ix.sidebar.toggle}
      />

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
            onEventClick={ix.taskSheet.onEventClick}
            onClickDate={ix.dayClick.onClickDate}
            onClickCycle={ix.cycleSheet.onCycleClick}
          />
          {tasks !== undefined && !hasScheduledTasks && <EmptyCalendarOverlay />}
          {ix.dragDrop.hoveredDropDate && (
            <style>{`.sx__calendar-wrapper [data-date="${ix.dragDrop.hoveredDropDate}"] { background: color-mix(in srgb, var(--color-primary) 15%, transparent) !important; }`}</style>
          )}
        </CalendarSidebarInset>

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

      {/* Mobile: day-tap bottom drawer */}
      <DayScheduleDrawer
        date={ix.dayClick.mobileDayDate}
        open={ix.dayClick.mobileDayDate !== null}
        onOpenChange={ix.dayClick.onMobileDrawerChange}
        allTasks={allTasks}
        unscheduledTasks={unscheduledTasks}
        onSchedule={ix.scheduleTask}
        onUnschedule={ix.unscheduleTask}
      />

      <Suspense fallback={null}>
        <LazyTaskDetailSheet
          taskId={ix.taskSheet.taskId}
          open={ix.taskSheet.open}
          onOpenChange={ix.taskSheet.onOpenChange}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LazyCreateTaskDialog
          projectId={projectId}
          workspaceId={workspaceId}
          open={ix.dayClick.clickCreateDate !== null}
          onOpenChange={ix.dayClick.onCreateDialogChange}
          plannedStartDate={ix.dayClick.clickCreateDate ?? undefined}
        />
      </Suspense>

      <CycleDetailSheet
        cycle={ix.cycleSheet.cycle}
        tasks={cycleTasks as EnrichedTask[] | undefined}
        onClose={ix.cycleSheet.onClose}
      />
    </div>
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
      }}
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
}: {
  taskEvents: CalendarEventExternal[];
  bgEvents: BackgroundEvent[];
  defaultView: string;
  isDark: boolean;
  onEventClick: (id: string | number) => void;
  onClickDate?: (date: string) => void;
  onClickCycle?: (name: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

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
  }, []);
  const [rangeVersion, setRangeVersion] = useState(0);

  const [calendarApp] = useState<CalendarApp>(() =>
    createCalendar({
      views: [createViewMonthGrid()],
      defaultView,
      events: taskEvents,
      backgroundEvents: bgEvents,
      calendars: CALENDARS_CONFIG,
      isDark,
      theme: "shadcn",
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
  }, [rangeVersion]);

  // Sync cycle background events into schedule-x imperatively (avoids remount).
  const bgEventsKeyRef = useRef("");
  useEffect(() => {
    const key = bgEvents.map((e) => `${String(e.start)}:${String(e.end)}`).join("|");
    if (key === bgEventsKeyRef.current) return;
    bgEventsKeyRef.current = key;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (calendarApp as any).$app.calendarEvents.backgroundEvents.value = bgEvents;
  }, [bgEvents, calendarApp]);

  // Sync live Convex task data into schedule-x incrementally.
  const eventsKeyRef = useRef("");
  useEffect(() => {
    const key = taskEvents
      .map((e) => {
        const meta = (e as any)._meta as EventMeta | undefined;
        return `${e.id}|${String(e.start)}|${String(e.end)}|${e.title}|${e.calendarId ?? ""}|${meta?.statusColor ?? ""}|${meta?.hasEstimate ?? ""}`;
      })
      .join(",");
    if (key === eventsKeyRef.current) return;
    eventsKeyRef.current = key;

    const existing = calendarApp.events.getAll();
    const existingMap = new Map(existing.map((e) => [String(e.id), e]));
    const newMap = new Map(taskEvents.map((e) => [String(e.id), e]));

    for (const [id] of existingMap) {
      if (!newMap.has(id)) calendarApp.events.remove(id);
    }
    for (const [id, event] of newMap) {
      if (!existingMap.has(id)) {
        calendarApp.events.add(event);
      } else {
        const prev = existingMap.get(id)!;
        const prevMeta = (prev as any)._meta as EventMeta | undefined;
        const newMeta = (event as any)._meta as EventMeta | undefined;
        if (
          String(prev.start) !== String(event.start) ||
          String(prev.end) !== String(event.end) ||
          prev.title !== event.title ||
          prev.calendarId !== event.calendarId ||
          prevMeta?.statusColor !== newMeta?.statusColor ||
          prevMeta?.hasEstimate !== newMeta?.hasEstimate
        ) {
          calendarApp.events.update(event);
        }
      }
    }
  }, [taskEvents, calendarApp]);

  return (
    <div style={{ height: "100%" }} ref={wrapperRef}>
      <ScheduleXCalendar
        calendarApp={calendarApp}
        customComponents={CALENDAR_CUSTOM_COMPONENTS}
      />
    </div>
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
