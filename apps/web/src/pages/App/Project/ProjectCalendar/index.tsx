import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useQuery } from "convex-helpers/react/cache";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { useTheme } from "next-themes";
import { useParams, useSearchParams } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  useCalendarInteractions,
  type CycleWithProgress,
  desktopStrategy,
  mobileStrategy,
} from "../useCalendarInteractions";
import { calendarDragContext } from "../calendarDragContext";
import { useEagerProjectTasks } from "../useDualProjectTasks";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import {
  CalendarSidebarProvider,
  CalendarSidebar,
  CalendarSidebarInset,
  CalendarSidebarHeader,
  CalendarSidebarContent,
} from "@/components/ui/calendar-sidebar";
import {
  type EnrichedTask,
  type TaskCalendarEvent,
  getTaskCalendarId,
  buildTaskEvents,
  buildWorkPeriodEvents,
  buildCycleBackgroundEvents,
} from "./calendar-events";
import {
  CalendarTaskMenuContext,
  type CalendarTaskMenuContextValue,
} from "./calendar-contexts";
import { CalendarRenderer } from "./CalendarRenderer";
import { CalendarGhostOverlay } from "./CalendarGhostOverlay";
import {
  UnscheduledTaskList,
  ScheduledSectionHeader,
  ScheduledTaskList,
} from "./CalendarSidebarLists";
import { DayScheduleDrawer } from "./DayScheduleDrawer";
import { CycleDetailSheet, EmptyCalendarOverlay } from "./CycleDetailSheet";
import { TaskDetailSheet } from "../TaskDetailSheet";
import {
  ScheduleHeader,
  type ScheduleView,
  type GanttViewMode,
} from "./ScheduleHeader";
import { GanttView, type GanttApi } from "./GanttView";
import "../project-calendar.css";

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
  const tasks = useEagerProjectTasks(projectId);
  const calendarData = useQuery(api.cycles.listForCalendar, { projectId });
  const dependencies =
    useQuery(api.edges.listTaskDependenciesByProject, { projectId }) ?? [];
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

  // View selection (calendar ↔ gantt) persisted in the URL so returning from a
  // task detail page lands back on the same view. `replace` so toggling doesn't
  // pollute history but the current entry's URL still carries the choice.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ScheduleView = searchParams.get("view") === "gantt" ? "gantt" : "calendar";
  const setView = (next: ScheduleView) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "calendar") p.delete("view");
        else p.set("view", next);
        return p;
      },
      { replace: true },
    );

  // Task detail sheet (opened from a calendar event / gantt bar click).
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);

  const [ganttViewMode, setGanttViewMode] = useState<GanttViewMode>("Week");
  // Gantt's unscheduled sidebar starts closed (like the calendar's).
  const [ganttDrawerOpen, setGanttDrawerOpen] = useState(false);
  const ganttApiRef = useRef<GanttApi | null>(null);

  // schedule-x navigation controls + range version, lifted here so the shared
  // header (rendered outside schedule-x) can drive month navigation.
  const [calendarControls] = useState(() => createCalendarControlsPlugin());
  const [rangeVersion, setRangeVersion] = useState(0);

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

  const scheduledTasks: EnrichedTask[] = allTasks.filter((t) => !!t.plannedStartDate);

  // Gantt drag preview: the dragged task + its snapped drop date, reported by
  // GanttView while a drag is in flight (cleared on drop/leave). Combined with
  // the post-drop optimistic `pendingSchedule` below to build the gantt task
  // list — see `ganttScheduledTasks`.
  const [ganttPreview, setGanttPreview] = useState<{ taskId: string; date: string } | null>(null);

  const taskCycleDueDate = new Map<string, string>(
    (calendarData?.taskCycleDueDatePairs ?? []).map(({ taskId, cycleDueDate }) => [taskId, cycleDueDate])
  );

  const { draggedTaskId, hoveredDropDate, pendingSchedule, clearPendingSchedule } = ix.dragDrop;

  // Gantt task list with both schedule overrides applied at each task's natural
  // `allTasks` position (so SVAR locks the bar to the row it'll really occupy):
  //  - `ganttPreview`: the dashed, in-flight drag preview
  //  - `pendingSchedule`: the solid, just-dropped bar held until Convex catches
  //    up — reusing the calendar's optimistic mechanism so the bar never flashes
  //    out and back in on release.
  // ganttPreview wins if both name the same task (active drag supersedes).
  const ganttScheduleOverrides = new Map<string, string>();
  if (pendingSchedule) ganttScheduleOverrides.set(pendingSchedule.taskId, pendingSchedule.date);
  if (ganttPreview) ganttScheduleOverrides.set(ganttPreview.taskId, ganttPreview.date);
  const ganttScheduledTasks: EnrichedTask[] =
    ganttScheduleOverrides.size === 0
      ? scheduledTasks
      : allTasks
          .map((t) => {
            const date = ganttScheduleOverrides.get(t._id);
            return date ? { ...t, plannedStartDate: date } : t;
          })
          .filter((t) => !!t.plannedStartDate);

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

  // Actual-time overlay: build work-period events for all toggled tasks.
  const { visibleTaskIds: visibleActualTaskIds } = ix.actualView;
  const workPeriodEvents = allTasks
    .filter((t) => visibleActualTaskIds.has(t._id))
    .flatMap((t) => buildWorkPeriodEvents(t));
  const taskEvents = [...baseTaskEvents, ...pendingUnscheduledEvents, ...workPeriodEvents];
  const bgEvents = buildCycleBackgroundEvents(cycles ?? []);
  const hasScheduledTasks = allTasks.some((t) => !!t.plannedStartDate);

  // Full-page navigation now lives inside TaskDetailSheet's expand button.
  const openTask = (taskId: string) => setSelectedTaskId(taskId as Id<"tasks">);
  const taskMenuCallbacks: CalendarTaskMenuContextValue = {
    onNavigate: openTask,
    onUnschedule: (taskId) => ix.unscheduleTask(taskId as Id<"tasks">),
  };

  // The unscheduled pool toggle in the shared header targets whichever pool is
  // relevant for the active view.
  const poolOpen = view === "calendar" ? ix.sidebar.open : ganttDrawerOpen;
  const onPoolToggle =
    view === "calendar" ? ix.sidebar.toggle : () => setGanttDrawerOpen((o) => !o);

  return (
    <CalendarTaskMenuContext.Provider value={taskMenuCallbacks}>
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-2">
      <ScheduleHeader
        view={view}
        onViewChange={setView}
        calendarControls={calendarControls}
        ganttViewMode={ganttViewMode}
        onGanttViewModeChange={setGanttViewMode}
        onGanttToday={() => ganttApiRef.current?.scrollToday()}
        onGanttPrev={() => ganttApiRef.current?.prev()}
        onGanttNext={() => ganttApiRef.current?.next()}
        commitmentMode={ix.commitmentMode}
        onCommitmentModeChange={ix.setCommitmentMode}
        unscheduledCount={unscheduledTasks.length}
        poolOpen={poolOpen}
        onPoolToggle={onPoolToggle}
      />

      {view === "gantt" ? (
        <GanttView
          scheduledTasks={ganttScheduledTasks}
          unscheduledTasks={unscheduledTasks}
          dependencies={dependencies}
          viewMode={ganttViewMode}
          multiplier={multiplier}
          drawerOpen={ganttDrawerOpen}
          onDrawerOpenChange={setGanttDrawerOpen}
          apiRef={ganttApiRef}
          onEmptyClick={(date) => ix.openDayDrawer(date)}
          previewTaskId={ganttPreview?.taskId ?? null}
          onPreviewChange={setGanttPreview}
          onSchedule={(taskId, date) => ix.dragDrop.scheduleOptimistic(taskId as Id<"tasks">, date)}
          isDark={isDark}
        />
      ) : (
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
              calendarControls={calendarControls}
              rangeVersion={rangeVersion}
              onRangeUpdate={() => setRangeVersion((v) => v + 1)}
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
            {/* Top section: unscheduled tasks (draggable) */}
            <CalendarSidebarHeader>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Unscheduled
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {unscheduledTasks.length}
                </span>
              </div>
            </CalendarSidebarHeader>
            <CalendarSidebarContent className="flex-1 min-h-0 overflow-y-auto">
              <UnscheduledTaskList tasks={unscheduledTasks} />
            </CalendarSidebarContent>

            {/* Bottom section: scheduled tasks with actual-time toggles */}
            <div className="border-t shrink-0" />
            <CalendarSidebarHeader>
              <ScheduledSectionHeader
                tasks={scheduledTasks}
                visibleActualTaskIds={visibleActualTaskIds}
                onSetAll={ix.actualView.setAll}
                onClearAll={ix.actualView.clearAll}
              />
            </CalendarSidebarHeader>
            <CalendarSidebarContent className="flex-1 min-h-0 overflow-y-auto">
              <ScheduledTaskList
                tasks={scheduledTasks}
                visibleActualTaskIds={visibleActualTaskIds}
                onToggle={ix.actualView.toggle}
              />
            </CalendarSidebarContent>
          </CalendarSidebar>
        </CalendarSidebarProvider>
      )}

      {/* Mobile: day-tap bottom drawer (calendar only) */}
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
        tasks={cycleTasks}
        onClose={ix.cycleSheet.onClose}
      />

      {/* Task detail — opens as the desktop side-sheet (full-screen on mobile)
          from a calendar event or gantt bar click. Its expand button still
          routes to the full task page. */}
      <TaskDetailSheet
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        workspaceId={workspaceId}
        projectId={projectId}
      />
    </div>
    </CalendarTaskMenuContext.Provider>
  );
}
ProjectCalendarContent.whyDidYouRender = true;
