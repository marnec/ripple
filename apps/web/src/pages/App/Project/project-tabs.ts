import { CalendarDays, Inbox, LayoutDashboard, ListTodo, RefreshCw, Settings } from "lucide-react";

/**
 * A project's tabs, in header order. Shared by `ProjectLayout` and the
 * dashboard's favorite-project cards, which link straight into them — kept
 * out of `ProjectLayout.tsx` so the dashboard doesn't pull that chunk in.
 */
export const PROJECT_TABS = [
  { label: "Overview", icon: LayoutDashboard, to: ".", end: true },
  { label: "Tasks", icon: ListTodo, to: "tasks", end: false },
  { label: "Backlog", icon: Inbox, to: "backlog", end: false },
  { label: "Cycles", icon: RefreshCw, to: "cycles", end: false },
  { label: "Schedule", icon: CalendarDays, to: "calendar", end: false },
  { label: "Settings", icon: Settings, to: "settings", end: false },
];
