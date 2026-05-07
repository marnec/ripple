/**
 * Custom header for the dashboard calendar — prev/next + Today + range
 * label + Week/Month switcher + member-overlay filter + New event.
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
import { Temporal } from "temporal-polyfill";
import { CalendarCheck, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { MemberCalendarFilter } from "./MemberCalendarFilter";
import { CalendarHeaderContext } from "./calendar-header-context";

export function CalendarHeader() {
  const ctx = useContext(CalendarHeaderContext);
  if (!ctx) return null;
  const {
    calendarControls,
    rangeVersion: _rangeVersion, // read to subscribe to nav changes
    view,
    setView,
    eventCount: _eventCount, // wired through context for future header chips
    onCreateEvent,
    filterableMembers,
    visibleMemberIds,
    setVisibleMemberIds,
  } = ctx;

  let date: Temporal.PlainDate | null = null;
  try {
    date = calendarControls.getDate();
  } catch {
    // calendar not initialised yet — fall through with safe defaults
  }

  // Read schedule-x's actual rendered view rather than only the React
  // `view` state. Two reasons:
  //  1. Small-screen auto-swap: schedule-x silently swaps "week" ⇄
  //     "week-agenda" and "month-grid" ⇄ "month-agenda" when the
  //     viewport crosses 700 px. Our React `view` only tracks the two
  //     wide-screen variants, so it can disagree with what's actually
  //     on screen.
  //  2. Initial render race: `defaultView: "week"` plus React `view`
  //     defaulting to "week" should agree, but if they ever drift, the
  //     stepper would advance by the wrong unit (the symptom users hit:
  //     "back/forward jumps a month while the week view is showing").
  // Falling back to React `view` keeps the buttons working before the
  // calendar finishes mounting, when `getView()` throws.
  const isMonthView = (() => {
    let v: string = view;
    try {
      v = calendarControls.getView() || view;
    } catch {
      /* calendar not yet initialised */
    }
    return v.startsWith("month");
  })();

  // Two label variants — long (desktop) shows the full week range with day
  // numbers; compact (mobile) drops the day numbers because "May 4 – 10,
  // 2026" eats the whole header row alongside nav buttons + view switcher.
  // For the week-view compact form we use the month/year of the week's
  // centre day (Thursday) so a Mon–Sun week that crosses a month boundary
  // still gets a sensible single-month label rather than a misleading
  // start-month-only one.
  const labels = (() => {
    if (!date) return { full: "", compact: "" };
    if (isMonthView) {
      const full = date.toLocaleString("en-US", { month: "long", year: "numeric" });
      return { full, compact: full };
    }
    // Week view
    const dow = date.dayOfWeek; // 1 (Mon) … 7 (Sun)
    const weekStart = date.subtract({ days: dow - 1 });
    const weekEnd = weekStart.add({ days: 6 });
    const sameMonth = weekStart.month === weekEnd.month;
    const sameYear = weekStart.year === weekEnd.year;
    const startFmt = weekStart.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    const endFmt = weekEnd.toLocaleString("en-US", {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    const full = `${startFmt} – ${endFmt}`;
    const centre = weekStart.add({ days: 3 });
    const compact = centre.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    return { full, compact };
  })();

  const stepBack = () => {
    if (!date) return;
    calendarControls.setDate(
      isMonthView ? date.subtract({ months: 1 }) : date.subtract({ weeks: 1 }),
    );
  };
  const stepForward = () => {
    if (!date) return;
    calendarControls.setDate(
      isMonthView ? date.add({ months: 1 }) : date.add({ weeks: 1 }),
    );
  };

  return (
    // No internal horizontal padding — `.sx__calendar-header` had its
    // 16px inline padding zeroed in project-calendar.css so the header
    // buttons sit flush with the toolbar's content edge.
    <div className="flex items-center justify-between w-full gap-2">
      {/* Left: nav + range label + Today */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepBack} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepForward} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="hidden sm:inline text-sm font-medium tabular-nums min-w-40">
          {labels.full}
        </span>
        <span className="sm:hidden text-sm font-medium tabular-nums">
          {labels.compact}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => calendarControls.setDate(Temporal.Now.plainDateISO())}
          aria-label="Today"
        >
          <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Today</span>
        </Button>
        {/* Member-calendar overlay filter — pick colleagues whose busy
            time should render as background blocks behind your own
            events. Hidden until the workspace member query resolves
            and the workspace has at least one OTHER member (a solo
            workspace would just show an empty popup). */}
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
