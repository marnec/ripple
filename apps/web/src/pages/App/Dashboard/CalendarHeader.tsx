/**
 * Custom header for the dashboard calendar — Week/Month switcher +
 * member-overlay filter + New event.
 *
 * Range navigation (prev/next/Today + range label) is NOT here: it lives
 * in the dashboard layout's toolbar next to the Tasks/Calendar switch —
 * see `CalendarNav`. Both read the same `CalendarHeaderContext`.
 *
 * The schedule-x `headerContent` slot renders without props, so values
 * the header needs (controls plugin, view state, member overlay, range
 * version) flow via `CalendarHeaderContext` set up by the parent
 * `MyCalendarTabContent`.
 *
 * Mirrors `ProjectCalendar`'s headerContent slot pattern but trimmed to
 * the controls a personal calendar actually needs (no commitment
 * toggle, no unscheduled sidebar).
 */

import { useContext } from "react";
import { CalendarDays, CalendarRange, Plus } from "lucide-react";

import { Button } from "@ripple/ui/components/button";

import { MemberCalendarFilter } from "./MemberCalendarFilter";
import { CalendarHeaderContext } from "./calendar-header-context";

export function CalendarHeader() {
  const ctx = useContext(CalendarHeaderContext);
  if (!ctx) return null;
  const {
    view,
    setView,
    eventCount: _eventCount, // wired through context for future header chips
    onCreateEvent,
    filterableMembers,
    visibleMemberIds,
    setVisibleMemberIds,
  } = ctx;

  return (
    // No internal horizontal padding — `.sx__calendar-header` had its
    // 16px inline padding zeroed in project-calendar.css so the header
    // buttons sit flush with the toolbar's content edge.
    <div className="flex items-center justify-between w-full gap-2">
      {/* Left: member-calendar overlay filter — pick colleagues whose busy
          time should render as background blocks behind your own events.
          Hidden until the workspace member query resolves and the workspace
          has at least one OTHER member (a solo workspace would just show an
          empty popup). Renders an empty flex box otherwise, which keeps the
          right cluster pinned to the trailing edge. */}
      <div className="flex items-center gap-1.5">
        {filterableMembers && filterableMembers.length > 0 && (
          <MemberCalendarFilter
            members={filterableMembers}
            selectedIds={visibleMemberIds}
            onSelectedIdsChange={setVisibleMemberIds}
          />
        )}
      </div>

      {/* Right cluster: view switcher + New event.
          New event is desktop-only — on mobile it'd crowd the calendar's
          own header out, so the parent renders a HeaderSlot fallback for
          "New event" (it's also implied by the visible event list).
          Order: switcher first, button last — placing the primary CTA at
          the trailing edge matches the rest of the app's toolbar layout
          and pairs the action with empty-state CTAs sitting below. */}
      <div className="flex items-center gap-2">
        {/* Week / Month switcher */}
        <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              view === "week"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setView("week")}
            aria-label="Week view"
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Week</span>
          </button>
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              view === "month-grid"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setView("month-grid")}
            aria-label="Month view"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Month</span>
          </button>
        </div>

        <Button
          size="sm"
          className="hidden md:inline-flex h-7"
          onClick={onCreateEvent}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New event
        </Button>
      </div>
    </div>
  );
}
