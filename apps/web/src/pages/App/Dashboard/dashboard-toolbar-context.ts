import { createContext } from "react";

/**
 * Portal target for controls a dashboard *tab* owns but that belong in the
 * layout's toolbar — the row that holds the Tasks/Calendar switch.
 *
 * The calendar's range nav (prev/next/Today + range label) lives here rather
 * than inside schedule-x's own header: it's the control users reach for most
 * and the toolbar is where the eye already is, so it gets the top row while
 * the calendar header keeps the secondary controls (view switcher, member
 * overlay, New event).
 *
 * `null` when no layout is mounted (a tab rendered standalone) — the slot
 * component no-ops in that case, exactly like `HeaderSlotContext`.
 */
export const DashboardToolbarSlotContext = createContext<HTMLDivElement | null>(
  null,
);
