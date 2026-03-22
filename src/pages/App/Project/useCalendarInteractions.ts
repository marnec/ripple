import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { currentDragTaskId, endDrag } from "./dragTracker";

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
  isMobile,
  cycles,
}: {
  isMobile: boolean;
  cycles: CycleWithProgress[] | undefined;
}) {
  const updateTask = useMutation(api.tasks.update);

  // 1. Commitment mode toggle
  const [commitmentMode, setCommitmentMode] = useState(false);

  // 2. Desktop sidebar
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);

  // 3. Task detail sheet (desktop) / task action drawer (mobile)
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [mobileTaskId, setMobileTaskId] = useState<Id<"tasks"> | null>(null);

  // 4. Cycle detail sheet
  const [selectedCycle, setSelectedCycle] = useState<CycleWithProgress | null>(null);

  // 5. Day click: desktop = create dialog, mobile = day drawer
  const [clickCreateDate, setClickCreateDate] = useState<string | null>(null);
  const [mobileDayDate, setMobileDayDate] = useState<string | null>(null);

  // 6. Drag-drop: dual-write — state drives the CSS highlight re-render,
  //    ref avoids stale closure in handleDragOver (called on every mousemove).
  const [hoveredDropDate, setHoveredDropDate] = useState<string | null>(null);
  const hoveredDropDateRef = useRef<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const draggedTaskIdRef = useRef<string | null>(null);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const date = findDateAtPoint(e.clientX, e.clientY);
    if (date !== hoveredDropDateRef.current) {
      hoveredDropDateRef.current = date;
      setHoveredDropDate(date);
    }
    const tid = currentDragTaskId;
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
    endDrag();
    const taskId = e.dataTransfer.getData("task-id") as Id<"tasks">;
    if (!taskId) return;
    const date = findDateAtPoint(e.clientX, e.clientY);
    if (!date) return;
    void updateTask({ taskId, plannedStartDate: date });
  }

  return {
    commitmentMode,
    setCommitmentMode,

    sidebar: {
      open: desktopSidebarOpen,
      onOpenChange: setDesktopSidebarOpen,
      toggle: () => setDesktopSidebarOpen((o) => !o),
    },

    taskSheet: {
      taskId: selectedTaskId,
      open: selectedTaskId !== null,
      onEventClick: (id: string | number) => {
        const idStr = String(id);
        if (idStr.startsWith("ghost-")) return;
        if (isMobile) setMobileTaskId(idStr as Id<"tasks">);
        else setSelectedTaskId(idStr as Id<"tasks">);
      },
      onOpenChange: (open: boolean) => { if (!open) setSelectedTaskId(null); },
    },

    mobileTaskDrawer: {
      taskId: mobileTaskId,
      open: mobileTaskId !== null,
      onOpenChange: (open: boolean) => { if (!open) setMobileTaskId(null); },
      onUnschedule: () => {
        if (mobileTaskId) void updateTask({ taskId: mobileTaskId, plannedStartDate: null });
        setMobileTaskId(null);
      },
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
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },

    dayClick: {
      onClickDate: (date: string) => {
        // schedule-x may pass a Temporal.PlainDate object despite the string type annotation
        const dateStr = String(date);
        if (isMobile) setMobileDayDate(dateStr);
        else setClickCreateDate(dateStr);
      },
      clickCreateDate,
      onCreateDialogChange: (open: boolean) => { if (!open) setClickCreateDate(null); },
      mobileDayDate,
      onMobileDrawerChange: (open: boolean) => { if (!open) setMobileDayDate(null); },
    },

    scheduleTask: (taskId: Id<"tasks">, date: string) =>
      void updateTask({ taskId, plannedStartDate: String(date) }),
    unscheduleTask: (taskId: Id<"tasks">) =>
      void updateTask({ taskId, plannedStartDate: null }),
  };
}
