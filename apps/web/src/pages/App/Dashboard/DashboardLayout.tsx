import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { CalendarDays, ListTodo } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

// Tabs mirror ProjectLayout's structure; the index tab uses `end: true` so
// "Tasks" doesn't stay highlighted when the user navigates into the
// calendar tab. Page is already framed as personal ("My Dashboard" header),
// so the per-tab "My" prefix was redundant.
const tabs = [
  { label: "Tasks", icon: ListTodo, to: ".", end: true },
  { label: "Calendar", icon: CalendarDays, to: "calendar", end: false },
];

export function DashboardLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header with inline tabs (right-aligned, mirrors ProjectLayout). */}
      <div className="flex items-center justify-between gap-4 px-3 border-b min-h-11">
        <div className="flex items-center gap-2 min-w-0">
          {!isMobile && (
            <h1 className="text-lg font-semibold truncate">My Dashboard</h1>
          )}
        </div>

        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted p-1 shrink-0">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
                  isActive
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <tab.icon className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {/* Outlet wrapper — flex-1 + min-h-0 preserves child scroll chains
          (kanban, calendar grid, etc.) the same way ProjectLayout does. */}
      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
