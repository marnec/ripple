import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

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

  // 3. Task detail sheet
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);

  // 4. Cycle detail sheet
  const [selectedCycle, setSelectedCycle] = useState<CycleWithProgress | null>(null);

  // 5. Day click: desktop = create dialog, mobile = day drawer
  const [clickCreateDate, setClickCreateDate] = useState<string | null>(null);
  const [mobileDayDate, setMobileDayDate] = useState<string | null>(null);

  // 6. Drag-drop: dual-write — state drives the CSS highlight re-render,
  //    ref avoids stale closure in handleDragOver (called on every mousemove).
  const [hoveredDropDate, setHoveredDropDate] = useState<string | null>(null);
  const hoveredDropDateRef = useRef<string | null>(null);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const date = findDateAtPoint(e.clientX, e.clientY);
    if (date !== hoveredDropDateRef.current) {
      hoveredDropDateRef.current = date;
      setHoveredDropDate(date);
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      hoveredDropDateRef.current = null;
      setHoveredDropDate(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    hoveredDropDateRef.current = null;
    setHoveredDropDate(null);
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
      onEventClick: (id: string | number) => setSelectedTaskId(String(id) as Id<"tasks">),
      onOpenChange: (open: boolean) => { if (!open) setSelectedTaskId(null); },
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
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },

    dayClick: {
      onClickDate: (date: string) => {
        if (isMobile) setMobileDayDate(date);
        else setClickCreateDate(date);
      },
      clickCreateDate,
      onCreateDialogChange: (open: boolean) => { if (!open) setClickCreateDate(null); },
      mobileDayDate,
      onMobileDrawerChange: (open: boolean) => { if (!open) setMobileDayDate(null); },
    },

    scheduleTask: (taskId: Id<"tasks">, date: string) =>
      void updateTask({ taskId, plannedStartDate: date }),
    unscheduleTask: (taskId: Id<"tasks">) =>
      void updateTask({ taskId, plannedStartDate: null }),
  };
}
