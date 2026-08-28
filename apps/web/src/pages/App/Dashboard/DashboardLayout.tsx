import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { CalendarDays, ListTodo } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { preloadMyCalendarTab } from "../preload";
import { DashboardToolbarSlotContext } from "./dashboard-toolbar-context";

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

  // Portal target for tab-owned toolbar controls (currently the calendar's
  // range nav). State, not a ref: the consuming tab has to re-render once
  // the node exists, otherwise its portal never mounts.
  const [toolbarNode, setToolbarNode] = useState<HTMLDivElement | null>(null);

  // Warm the @schedule-x/* chunk in the background while MyTasksTab renders.
  // Covers the non-admin auto-redirect path (no hover gesture available);
  // admins typically also benefit since they reach this layout via the
  // sidebar. Idempotent — see ./preload.ts.
  useEffect(() => {
    void preloadMyCalendarTab();
  }, []);

  return (
    <DashboardToolbarSlotContext.Provider value={toolbarNode}>
      <div className="flex h-full w-full flex-col">
        {/* Header with inline tabs (right-aligned, mirrors ProjectLayout). */}
        <div className="flex items-center justify-between gap-4 px-4 border-b min-h-11">
          {/* Left cluster: title + whatever controls the active tab owns.
              The calendar tab mounts its range nav (prev/next/Today +
              label) here through DashboardToolbarSlot; the Tasks tab
              leaves it empty, and `empty:hidden` keeps that from paying
              for a flex gap. The portal fills the box at runtime, so
              there is nothing to conditionally render. */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isMobile && (
              <h1 className="text-lg font-semibold truncate">My Dashboard</h1>
            )}
            <div
              ref={setToolbarNode}
              className="flex items-center min-w-0 empty:hidden"
            />
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
    </DashboardToolbarSlotContext.Provider>
  );
}
