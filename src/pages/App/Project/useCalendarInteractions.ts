import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { type DragContext } from "./dragContext";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CycleWithProgress = {
  _id: string;
  name: string;
  startDate?: string;
  dueDate?: string;
  status: "draft" | "upcoming" | "active" | "completed";
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
};

export type DayFocusTarget =
  | { surface: "drawer"; date: string }
  | null;

export interface CalendarInteractionStrategy {
  resolveDayFocus(date: string): DayFocusTarget;
}

export const desktopStrategy: CalendarInteractionStrategy = {
  resolveDayFocus: (_date) => null,
};

export const mobileStrategy: CalendarInteractionStrategy = {
  resolveDayFocus: (date) => ({ surface: "drawer", date }),
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM helper (only used by drag handlers)
// ─────────────────────────────────────────────────────────────────────────────

function findDateAtPoint(x: number, y: number): string | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const d =
      el.getAttribute("data-time-grid-day") ??
      el.getAttribute("data-date");
    if (d) return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCalendarInteractions({
  strategy,
  cycles,
  dragContext,
}: {
  strategy: CalendarInteractionStrategy;
  cycles: CycleWithProgress[] | undefined;
  dragContext: DragContext;
}) {
  const updateTask = useMutation(api.tasks.update);

  // 1. Commitment mode toggle
  const [commitmentMode, setCommitmentMode] = useState(false);

  // 2. Desktop sidebar
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);

  // 3. Actual-time visibility — show work periods for selected tasks
  const [visibleActualTaskIds, setVisibleActualTaskIds] = useState<Set<string>>(new Set());

  // 4. Cycle detail sheet
  const [selectedCycle, setSelectedCycle] = useState<CycleWithProgress | null>(null);

  // 5. Day focus (mobile day-tap)
  const [dayFocus, setDayFocus] = useState<DayFocusTarget>(null);

  // 6. Drag-drop: dual-write — state drives the CSS highlight re-render,
  //    ref avoids stale closure in handleDragOver (called on every mousemove).
  const [hoveredDropDate, setHoveredDropDate] = useState<string | null>(null);
  const hoveredDropDateRef = useRef<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const draggedTaskIdRef = useRef<string | null>(null);

  // 7. Optimistic schedule: holds the committed (taskId, date) pair until the
  //    Convex query catches up, preventing the task from snapping back to its
  //    old position between the drop and the server round-trip.
  const [pendingSchedule, setPendingSchedule] = useState<{ taskId: string; date: string } | null>(null);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const date = findDateAtPoint(e.clientX, e.clientY);
    if (date !== hoveredDropDateRef.current) {
      hoveredDropDateRef.current = date;
      setHoveredDropDate(date);
    }
    const tid = dragContext.currentTaskId;
    if (tid !== draggedTaskIdRef.current) {
      draggedTaskIdRef.current = tid;
      setDraggedTaskId(tid);
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      hoveredDropDateRef.current = null;
      setHoveredDropDate(null);
      draggedTaskIdRef.current = null;
      setDraggedTaskId(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    hoveredDropDateRef.current = null;
    setHoveredDropDate(null);
    draggedTaskIdRef.current = null;
    setDraggedTaskId(null);
    dragContext.clearDragTask();
    const taskId = e.dataTransfer.getData("task-id") as Id<"tasks">;
    if (!taskId) return;
    const date = findDateAtPoint(e.clientX, e.clientY);
    if (!date) return;
    // Optimistically show the task at its new position before the server responds.
    setPendingSchedule({ taskId, date });
    void updateTask({ taskId, plannedStartDate: date }).catch(() => {
      setPendingSchedule(null);
    });
  }

  return {
    commitmentMode,
    setCommitmentMode,

    sidebar: {
      open: desktopSidebarOpen,
      onOpenChange: setDesktopSidebarOpen,
      toggle: () => setDesktopSidebarOpen((o) => !o),
    },

    actualView: {
      visibleTaskIds: visibleActualTaskIds,
      toggle: (taskId: string) => {
        setVisibleActualTaskIds((prev) => {
          const next = new Set(prev);
          if (next.has(taskId)) next.delete(taskId);
          else next.add(taskId);
          return next;
        });
      },
      setAll: (taskIds: string[]) => setVisibleActualTaskIds(new Set(taskIds)),
      clearAll: () => setVisibleActualTaskIds(new Set()),
    },

    // Task menu interactions are handled inside CustomEventContent via
    // ResponsiveDropdownMenu. This callback is still wired to schedule-x but
    // only needs to ignore synthetic/non-task event IDs.
    onEventClick: (id: string | number) => {
      const idStr = String(id);
      if (idStr.startsWith("ghost-") || idStr.startsWith("actual-")) return;
    },

    dayFocus,
    clearDayFocus: () => setDayFocus(null),
    onClickDate: (date: string) => {
      // schedule-x may pass a Temporal.PlainDate object despite the string type annotation
      const target = strategy.resolveDayFocus(String(date));
      if (target) setDayFocus(target);
    },

    cycleSheet: {
      cycle: selectedCycle,
      onCycleClick: (name: string) => {
        const cycle = (cycles ?? []).find((c) => c.name === name);
        if (cycle) setSelectedCycle(cycle);
      },
      onClose: () => setSelectedCycle(null),
    },

    dragDrop: {
      hoveredDropDate,
      draggedTaskId,
      pendingSchedule,
      clearPendingSchedule: () => setPendingSchedule(null),
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },

    scheduleTask: (taskId: Id<"tasks">, date: string) =>
      void updateTask({ taskId, plannedStartDate: String(date) }),
    unscheduleTask: (taskId: Id<"tasks">) =>
      void updateTask({ taskId, plannedStartDate: null }),
  };
}
