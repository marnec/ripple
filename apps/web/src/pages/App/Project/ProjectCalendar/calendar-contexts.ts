import { createContext } from "react";
import type { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";

// Contexts live in their own (component-free) module so the schedule-x event
// content file can export only components — Fast Refresh requires a file to not
// mix component and non-component exports.

// ─────────────────────────────────────────────────────────────────────────────
// Task action menu context (View / Unschedule) — owned by the orchestrator,
// consumed by the schedule-x-rendered CustomEventContent.
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarTaskMenuContextValue = {
  onNavigate: (taskId: string) => void;
  onUnschedule: (taskId: string) => void;
};

export const CalendarTaskMenuContext =
  createContext<CalendarTaskMenuContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Two contexts feed CalendarHeaderContent (the schedule-x header slot):
//   CalendarHeaderConfigContext  — owned by the orchestrator (business state)
//   CalendarInternalContext      — owned by CalendarRenderer (schedule-x-bound state)
// Splitting them by ownership avoids a merged pass-through in CalendarRenderer.
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarHeaderConfigValue = {
  commitmentMode: boolean;
  onCommitmentModeChange: (value: boolean) => void;
  unscheduledCount: number;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
};

export const CalendarHeaderConfigContext =
  createContext<CalendarHeaderConfigValue | null>(null);

export type CalendarInternalValue = {
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  /** Bumped on every range update so the header re-reads the current date. */
  rangeVersion: number;
};

export const CalendarInternalContext =
  createContext<CalendarInternalValue | null>(null);
