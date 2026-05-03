import { AlertCircle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { createElement } from "react";

export function formatTaskId(
  projectKey?: string,
  number?: number,
): string | undefined {
  if (!projectKey || number == null) return undefined;
  return `${projectKey}-${number}`;
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

const PRIORITY_CONFIG = {
  urgent: { icon: AlertCircle, color: "text-red-500", label: "Urgent" },
  high: { icon: ArrowUp, color: "text-orange-500", label: "High" },
  medium: { icon: Minus, color: "text-yellow-500", label: "Medium" },
  low: { icon: ArrowDown, color: "text-gray-400", label: "Low" },
} as const;

export type TaskPriority = keyof typeof PRIORITY_CONFIG;

export const PRIORITIES = (
  ["urgent", "high", "medium", "low"] as const
).map((value) => ({
  value,
  label: PRIORITY_CONFIG[value].label,
}));

export function getPriorityIcon(
  priority: string,
  className = "w-4 h-4",
): React.ReactNode {
  const cfg = PRIORITY_CONFIG[priority as TaskPriority];
  if (!cfg) return createElement(Minus, { className: `${className} text-gray-400` });
  return createElement(cfg.icon, { className: `${className} ${cfg.color}` });
}

export function getPriorityLabel(priority: string): string {
  const cfg = PRIORITY_CONFIG[priority as TaskPriority];
  return cfg?.label ?? priority.charAt(0).toUpperCase() + priority.slice(1);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Convert Date to ISO date string (YYYY-MM-DD) in local timezone */
export function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse ISO date string to Date in local timezone */
export function parseISODate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isOverdue(dueDate: string): boolean {
  const due = new Date(dueDate + "T23:59:59");
  return due < new Date();
}

export function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatEstimate(hours: number): string {
  return `${hours}h`;
}

export const ESTIMATE_PRESETS = [0.5, 1, 2, 4, 8, 16, 24, 40] as const;
