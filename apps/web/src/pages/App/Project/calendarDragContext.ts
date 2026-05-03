import { createDragContext } from "./dragContext";

/**
 * Singleton drag context for the calendar page.
 * Import this in ProjectCalendar.tsx components; inject createDragContext() in tests.
 */
export const calendarDragContext = createDragContext();
