import { createContext } from "react";
import type { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";

import type { Id } from "@convex/_generated/dataModel";
import type { MemberCalendarMember } from "./MemberCalendarFilter";

export type DashboardCalendarView = "week" | "month-grid";

export type CalendarHeaderValue = {
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  /** Bumped on every range update so the header re-reads the current date. */
  rangeVersion: number;
  /** React-owned view state — drives the highlight directly. Single
   *  source of truth, kept in sync with schedule-x via `setView`. */
  view: DashboardCalendarView;
  setView: (next: DashboardCalendarView) => void;
  /** `null` while the events query is loading — header hides the counter
   *  in that state to avoid a "0 scheduled" flash before data lands. */
  eventCount: number | null;
  onCreateEvent: () => void;
  /** Workspace members the viewer can overlay (excludes themselves).
   *  `null` while the members query is loading — header hides the
   *  combobox trigger in that state to avoid a flicker. */
  filterableMembers: MemberCalendarMember[] | null;
  /** Currently overlaid members (subset of `filterableMembers`). */
  visibleMemberIds: Id<"users">[];
  setVisibleMemberIds: (ids: Id<"users">[]) => void;
};

export const CalendarHeaderContext = createContext<CalendarHeaderValue | null>(
  null,
);
