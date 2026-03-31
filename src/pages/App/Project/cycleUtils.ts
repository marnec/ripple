/** Format a start/end date range as a human-readable string, e.g. "Mar 1 – Mar 31". */
export function formatDateRange(
  startDate?: string,
  dueDate?: string,
): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  if (startDate && dueDate) return `${fmt(startDate)} – ${fmt(dueDate)}`;
  if (startDate) return `from ${fmt(startDate)}`;
  if (dueDate) return `until ${fmt(dueDate)}`;
  return "";
}

/** Days remaining until dueDate (0 = today, negative = past). Returns null if no dueDate. */
export function daysRemaining(dueDate?: string): number | null {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(dueDate + "T00:00:00");
  const now = new Date(today + "T00:00:00");
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

import type { CycleStatus } from "@shared/types/cycles";

/** Status color classes for badges */
export const CYCLE_STATUS_STYLES: Record<
  CycleStatus,
  { badge: string; dot: string }
> = {
  draft: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  upcoming: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  active: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  completed: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};
