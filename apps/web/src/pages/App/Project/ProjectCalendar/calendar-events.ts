import { Temporal } from "temporal-polyfill";
import type {
  CalendarEventExternal,
  BackgroundEvent,
  CalendarType,
} from "@schedule-x/calendar";
import {
  estimateToDays,
  addCalendarDays,
  isDateConflict,
  resolveEffectiveDueDate,
} from "@/lib/calendar-utils";
import type { CycleWithProgress } from "../useCalendarInteractions";

// ─────────────────────────────────────────────────────────────────────────────
// Colors
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

export function tailwindToHex(cls: string): string {
  return TAILWIND_TO_HEX[cls] ?? "#6b7280";
}

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

export function formatDayTitle(isoDate: string): string {
  return Temporal.PlainDate.from(isoDate).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EnrichedTask = {
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

export type EventMeta = {
  statusColor: string;
  hasEstimate: boolean;
  taskId: string;
  isActual: boolean;
  hasActualData: boolean;
  actualHours?: number;
  plannedHours?: number;
  /** Epoch ms — only set on isActual events, used for the hover tooltip. */
  startMs?: number;
  endMs?: number;
};

export type TaskCalendarEvent = CalendarEventExternal & {
  readonly _meta: EventMeta;
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar ID constants — 4 visual states (+ actual overlay)
// ─────────────────────────────────────────────────────────────────────────────

const CAL_NORMAL = "normal";
const CAL_NORMAL_INACTIVE = "normal-inactive";
const CAL_CONFLICT = "conflict";
const CAL_CONFLICT_INACTIVE = "conflict-inactive";
const CAL_ACTUAL = "actual";

export const CALENDARS_CONFIG: Record<string, CalendarType> = {
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
  [CAL_ACTUAL]: {
    colorName: "actual",
    lightColors: { main: "#6366f1", container: "#6366f110", onContainer: "#6366f1" },
    darkColors: { main: "#818cf8", container: "#818cf810", onContainer: "#818cf8" },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Event builders
// ─────────────────────────────────────────────────────────────────────────────

export function getTaskCalendarId(
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

export function fmtHours(h: number): string {
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function totalCompletedHours(workPeriods: { startedAt: number; completedAt?: number }[]): number {
  return workPeriods
    .filter((p) => p.completedAt !== undefined)
    .reduce((acc, p) => acc + (p.completedAt! - p.startedAt), 0) / 3_600_000;
}

export function hasActualData(task: EnrichedTask): boolean {
  return !!task.workPeriods?.some((p) => p.completedAt !== undefined);
}

export function buildTaskEvents(
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

      const completedPeriods = (t.workPeriods ?? []).filter((p) => p.completedAt !== undefined);
      const hasActualDataFlag = completedPeriods.length > 0;
      const actualHours = hasActualDataFlag ? totalCompletedHours(t.workPeriods!) : undefined;

      const meta: EventMeta = {
        statusColor: t.status ? tailwindToHex(t.status.color) : "#6b7280",
        hasEstimate: !!t.estimate,
        taskId: t._id,
        isActual: false,
        hasActualData: hasActualDataFlag,
        actualHours,
        plannedHours: t.estimate,
      };

      return {
        id: t._id,
        title: t.title,
        start: Temporal.PlainDate.from(t.plannedStartDate!),
        end: Temporal.PlainDate.from(endDate),
        calendarId,
        _meta: meta,
      };
    });
}

export function buildWorkPeriodEvents(task: EnrichedTask): TaskCalendarEvent[] {
  if (!task.workPeriods) return [];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return task.workPeriods
    .filter((p) => p.completedAt !== undefined)
    .map((p, i) => {
      const startDate = Temporal.Instant.fromEpochMilliseconds(p.startedAt)
        .toZonedDateTimeISO(tz)
        .toPlainDate()
        .toString();
      const endDate = Temporal.Instant.fromEpochMilliseconds(p.completedAt!)
        .toZonedDateTimeISO(tz)
        .toPlainDate()
        .toString();
      const meta: EventMeta = {
        statusColor: task.status ? tailwindToHex(task.status.color) : "#6b7280",
        hasEstimate: false,
        taskId: task._id,
        isActual: true,
        hasActualData: false,
        actualHours: undefined,
        plannedHours: undefined,
        startMs: p.startedAt,
        endMs: p.completedAt,
      };
      return {
        id: `actual-${task._id}-${i}`,
        title: task.title,
        start: Temporal.PlainDate.from(startDate),
        end: Temporal.PlainDate.from(endDate),
        calendarId: CAL_ACTUAL,
        _meta: meta,
      };
    });
}

export function buildCycleBackgroundEvents(cycles: CycleWithProgress[]): BackgroundEvent[] {
  return cycles
    .filter((c) => c.startDate && c.dueDate)
    .map((c) => ({
      start: Temporal.PlainDate.from(c.startDate!),
      end: Temporal.PlainDate.from(c.dueDate!),
      title: c.name,
      // `--sx-bg-event-opacity` drives both the persistent dim *and*
      // the fade-in keyframe's `to` value (see project-calendar.css) so
      // the entrance lands exactly at the natural opacity — no end-of-
      // animation snap-down from 1 to 0.6.
      style: {
        background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
        borderLeft: "2px solid var(--color-primary)",
        "--sx-bg-event-opacity": "0.6",
      },
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Actual event tooltip formatter
// ─────────────────────────────────────────────────────────────────────────────

export function formatWorkPeriodTooltip(startMs: number, endMs: number): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = Temporal.Instant.fromEpochMilliseconds(startMs).toZonedDateTimeISO(tz);
  const end = Temporal.Instant.fromEpochMilliseconds(endMs).toZonedDateTimeISO(tz);
  const fmtTime = (d: Temporal.ZonedDateTime) =>
    d.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const fmtDate = (d: Temporal.ZonedDateTime) =>
    d.toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" });
  const sameDay = Temporal.PlainDate.compare(start.toPlainDate(), end.toPlainDate()) === 0;
  return sameDay
    ? `${fmtDate(start)} · ${fmtTime(start)} – ${fmtTime(end)}`
    : `${fmtDate(start)} ${fmtTime(start)} – ${fmtDate(end)} ${fmtTime(end)}`;
}
