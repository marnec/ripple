/**
 * Range navigation for the dashboard calendar — prev / next / Today plus
 * the current range label.
 *
 * Rendered into the dashboard layout's toolbar (the row with the
 * Tasks/Calendar switch) via `DashboardToolbarSlot`, not into schedule-x's
 * own header: stepping through weeks and months is the calendar's primary
 * gesture, so it gets the top row while `CalendarHeader` keeps the
 * secondary controls (view switcher, member overlay, New event).
 *
 * Values come from `CalendarHeaderContext`, shared with `CalendarHeader`.
 */

import { useContext } from "react";
import { Temporal } from "temporal-polyfill";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@ripple/ui/components/button";

import { CalendarHeaderContext } from "./calendar-header-context";
import { formatCalendarRangeLabels } from "./dashboard-calendar-utils";

export function CalendarNav() {
  const ctx = useContext(CalendarHeaderContext);
  if (!ctx) return null;
  const {
    calendarControls,
    rangeVersion: _rangeVersion, // read to subscribe to nav changes
    view,
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

  const labels = formatCalendarRangeLabels(date, isMonthView);

  const step = (direction: -1 | 1) => {
    if (!date) return;
    const amount = isMonthView ? { months: 1 } : { weeks: 1 };
    calendarControls.setDate(
      direction === 1 ? date.add(amount) : date.subtract(amount),
    );
  };

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => step(-1)}
        aria-label={isMonthView ? "Previous month" : "Previous week"}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => step(1)}
        aria-label={isMonthView ? "Next month" : "Next week"}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {/* Reserved width so stepping between ranges of different label
          lengths doesn't shuffle the buttons around. */}
      <span className="hidden sm:inline text-sm font-medium tabular-nums min-w-40 truncate">
        {labels.full}
      </span>
      <span className="sm:hidden text-sm font-medium tabular-nums truncate">
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
    </div>
  );
}
