/**
 * Calendar grid constants shared by:
 *   • MyCalendarTab's drag-to-create cursor → slot snapping
 *   • InlineEventCreator's ghost geometry mapping
 *   • CursorTimeIndicator's hover affordance
 *
 * All three need to agree on the slot granularity and the
 * minutes-per-day total — drift between any pair would put the
 * visual hint on a different slot than the actual click result.
 *
 * If schedule-x's `dayBoundaries` ever becomes non-default
 * (00:00–24:00), the day-range constants here must be revised
 * alongside it.
 */

export const SLOT_MINUTES = 15;
export const DAY_MINUTES = 24 * 60; // schedule-x default day boundary range
export const DAY_START_MINUTES = 0;
export const DAY_END_MINUTES = DAY_MINUTES;
