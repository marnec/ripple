import type { Id } from "@convex/_generated/dataModel";

/**
 * The dashboard calendar tab interleaves three record kinds inside one
 * schedule-x event list: tasks (`task-${id}`), calendar events
 * (`event-${id}`), and occurrences of a series
 * (`occurrence-${seriesId}@${originalStartMs}`). Schedule-x exposes IDs as
 * opaque strings, so the prefix is the only signal callers have to route a
 * click / drag / update back to the right Convex table.
 *
 * An occurrence is the odd one out and deliberately so: it has no row, so it
 * cannot be named by an id. Its name is the (series, original start) pair, and
 * carrying both through this string is what lets a click on next Tuesday's
 * standup mean *that* Tuesday. An **override** is a `calendarEvents` row and
 * so still travels as an `event-`.
 *
 * `parseScheduleXEventId` turns that string into a typed
 * discriminated union so the consumer never has to hand-write
 * `id.slice(6) as Id<"calendarEvents">` (or the equivalent for
 * tasks). Returns `null` for unknown shapes — callers should treat
 * that as a no-op rather than a bug.
 */

export const SCHEDULE_X_EVENT_PREFIX = "event-";
export const SCHEDULE_X_TASK_PREFIX = "task-";
export const SCHEDULE_X_OCCURRENCE_PREFIX = "occurrence-";

/** Separates the series from the original start. Convex ids never contain it. */
const OCCURRENCE_SEPARATOR = "@";

export type ScheduleXEventId =
  | { kind: "event"; id: Id<"calendarEvents"> }
  | { kind: "task"; id: Id<"tasks"> }
  | {
      kind: "occurrence";
      seriesId: Id<"eventSeries">;
      originalStartMs: number;
    };

export function parseScheduleXEventId(
  raw: string | number,
): ScheduleXEventId | null {
  if (typeof raw !== "string") return null;
  if (raw.startsWith(SCHEDULE_X_EVENT_PREFIX)) {
    return {
      kind: "event",
      id: raw.slice(SCHEDULE_X_EVENT_PREFIX.length) as Id<"calendarEvents">,
    };
  }
  if (raw.startsWith(SCHEDULE_X_OCCURRENCE_PREFIX)) {
    const body = raw.slice(SCHEDULE_X_OCCURRENCE_PREFIX.length);
    const at = body.lastIndexOf(OCCURRENCE_SEPARATOR);
    if (at <= 0) return null;
    const originalStartMs = Number(body.slice(at + 1));
    if (!Number.isFinite(originalStartMs)) return null;
    return {
      kind: "occurrence",
      seriesId: body.slice(0, at) as Id<"eventSeries">,
      originalStartMs,
    };
  }
  if (raw.startsWith(SCHEDULE_X_TASK_PREFIX)) {
    return {
      kind: "task",
      id: raw.slice(SCHEDULE_X_TASK_PREFIX.length) as Id<"tasks">,
    };
  }
  return null;
}

export function formatScheduleXEventId(parsed: ScheduleXEventId): string {
  switch (parsed.kind) {
    case "event":
      return `${SCHEDULE_X_EVENT_PREFIX}${parsed.id}`;
    case "task":
      return `${SCHEDULE_X_TASK_PREFIX}${parsed.id}`;
    case "occurrence":
      return `${SCHEDULE_X_OCCURRENCE_PREFIX}${parsed.seriesId}${OCCURRENCE_SEPARATOR}${parsed.originalStartMs}`;
  }
}
