import { useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { useQuery } from "convex-helpers/react/cache";
import { useTheme } from "next-themes";
import { useNavigate, useParams } from "react-router-dom";
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
  CalendarHeaderConfigContext,
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

  const scheduledTasks: EnrichedTask[] = allTasks.filter((t) => !!t.plannedStartDate);

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

  // Actual-time overlay: build work-period events for all toggled tasks.
  const { visibleTaskIds: visibleActualTaskIds } = ix.actualView;
  const workPeriodEvents = allTasks
    .filter((t) => visibleActualTaskIds.has(t._id))
    .flatMap((t) => buildWorkPeriodEvents(t));
  const taskEvents = [...baseTaskEvents, ...pendingUnscheduledEvents, ...workPeriodEvents];
  const bgEvents = buildCycleBackgroundEvents(cycles ?? []);
  const hasScheduledTasks = allTasks.some((t) => !!t.plannedStartDate);

  const navigate = useNavigate();
  const taskMenuCallbacks: CalendarTaskMenuContextValue = {
    onNavigate: (taskId) =>
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`),
    onUnschedule: (taskId) => ix.unscheduleTask(taskId as Id<"tasks">),
  };

  return (
    <CalendarTaskMenuContext.Provider value={taskMenuCallbacks}>
    <CalendarHeaderConfigContext.Provider value={{
      commitmentMode: ix.commitmentMode,
      onCommitmentModeChange: ix.setCommitmentMode,
      unscheduledCount: unscheduledTasks.length,
      sidebarOpen: ix.sidebar.open,
      onSidebarToggle: ix.sidebar.toggle,
    }}>
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-2">
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
        tasks={cycleTasks}
        onClose={ix.cycleSheet.onClose}
      />
    </div>
    </CalendarHeaderConfigContext.Provider>
    </CalendarTaskMenuContext.Provider>
  );
}
ProjectCalendarContent.whyDidYouRender = true;
