import { createContext } from "react";

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
