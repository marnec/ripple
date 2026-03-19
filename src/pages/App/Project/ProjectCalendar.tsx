import React, { Suspense, useEffect, useState } from "react";
import {
  createCalendar,
  createViewWeek,
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
import { CalendarDays } from "lucide-react";
import { useParams } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
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

type EnrichedTask = {
  _id: string;
  title: string;
  statusId: string;
  dueDate?: string;
  startDate?: string;
  status: { color: string; name: string } | null;
};

type CycleWithProgress = {
  _id: string;
  name: string;
  startDate?: string;
  dueDate?: string;
};

function buildTaskEvents(tasks: EnrichedTask[]): CalendarEventExternal[] {
  return tasks
    .filter((t) => t.dueDate ?? t.startDate)
    .map((t) => ({
      id: t._id,
      title: t.title,
      start: Temporal.PlainDate.from(t.startDate ?? t.dueDate!),
      end: Temporal.PlainDate.from(t.dueDate ?? t.startDate!),
      calendarId: t.statusId,
    }));
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

function buildCalendarsConfig(tasks: EnrichedTask[]): Record<string, CalendarType> {
  const seen = new Set<string>();
  const result: Record<string, CalendarType> = {};

  for (const task of tasks) {
    if (!task.status || seen.has(task.statusId)) continue;
    seen.add(task.statusId);
    const hex = tailwindToHex(task.status.color);
    result[task.statusId] = {
      colorName: task.status.name,
      lightColors: { main: hex, container: hex + "30", onContainer: "#111827" },
      darkColors: { main: hex, container: hex + "30", onContainer: "#f9fafb" },
    };
  }

  return result;
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
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const isDark = resolvedTheme === "dark";

  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const sheetOpen = selectedTaskId !== null;

  const taskEvents = buildTaskEvents((tasks ?? []) as EnrichedTask[]);
  const bgEvents = buildCycleBackgroundEvents((cycles ?? []) as CycleWithProgress[]);
  const calendarsConfig = buildCalendarsConfig((tasks ?? []) as EnrichedTask[]);
  const hasScheduledTasks = (tasks ?? []).some(
    (t) => (t as EnrichedTask).dueDate ?? (t as EnrichedTask).startDate,
  );

  // Key CalendarRenderer to force remount when isDark or background events change.
  // bgKey is based on stable cycle data (IDs + date range) so remounts are infrequent.
  const bgKey = bgEvents
    .map((e) => `${String(e.start)}:${String(e.end)}`)
    .join("|");
  const calendarKey = String(isDark) + "|" + bgKey;

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 md:px-6 md:pt-6 pb-4">
      <div className="flex-1 min-h-0 relative">
        <CalendarRenderer
          key={calendarKey}
          taskEvents={taskEvents}
          bgEvents={bgEvents}
          calendarsConfig={calendarsConfig}
          defaultView={isMobile ? "month-grid" : "week"}
          isDark={isDark}
          onEventClick={(id) => setSelectedTaskId(id as Id<"tasks">)}
        />
        {tasks !== undefined && !hasScheduledTasks && <EmptyCalendarOverlay />}
      </div>
      <Suspense fallback={null}>
        <LazyTaskDetailSheet
          taskId={selectedTaskId}
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      </Suspense>
    </div>
  );
}
ProjectCalendarContent.whyDidYouRender = true;

// ─────────────────────────────────────────────────────────────────────────────
// CalendarRenderer — stable calendarApp instance per key
// ─────────────────────────────────────────────────────────────────────────────

function CalendarRenderer({
  taskEvents,
  bgEvents,
  calendarsConfig,
  defaultView,
  isDark,
  onEventClick,
}: {
  taskEvents: CalendarEventExternal[];
  bgEvents: BackgroundEvent[];
  calendarsConfig: Record<string, CalendarType>;
  defaultView: string;
  isDark: boolean;
  onEventClick: (id: string | number) => void;
}) {
  const [calendarApp] = useState<CalendarApp>(() =>
    createCalendar({
      views: [createViewWeek(), createViewMonthGrid()],
      defaultView,
      events: taskEvents,
      backgroundEvents: bgEvents,
      calendars: calendarsConfig,
      isDark,
      callbacks: {
        onEventClick(event) {
          onEventClick(event.id);
        },
      },
    }),
  );

  // Sync live Convex task data into schedule-x (external system sync via useEffect)
  useEffect(() => {
    calendarApp.events.set(taskEvents);
  }, [taskEvents, calendarApp]);

  return <ScheduleXCalendar calendarApp={calendarApp} />;
}
CalendarRenderer.whyDidYouRender = true;

// ─────────────────────────────────────────────────────────────────────────────
// Empty state overlay (shown on top of the grid when no tasks are scheduled)
// ─────────────────────────────────────────────────────────────────────────────

function EmptyCalendarOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-2 text-center bg-background/80 backdrop-blur-sm rounded-lg px-6 py-4 pointer-events-auto">
        <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No scheduled tasks</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Add a due date or start date to tasks to see them here.
        </p>
      </div>
    </div>
  );
}
