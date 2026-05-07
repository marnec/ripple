import type { Id } from "@convex/_generated/dataModel";

/**
 * The dashboard calendar tab interleaves two record kinds inside one
 * schedule-x event list: tasks (`task-${id}`) and calendar events
 * (`event-${id}`). Schedule-x exposes IDs as opaque strings, so the
 * prefix is the only signal callers have to route a click / drag /
 * update back to the right Convex table.
 *
 * `parseScheduleXEventId` turns that string into a typed
 * discriminated union so the consumer never has to hand-write
 * `id.slice(6) as Id<"calendarEvents">` (or the equivalent for
 * tasks). Returns `null` for unknown shapes — callers should treat
 * that as a no-op rather than a bug.
 */

export const SCHEDULE_X_EVENT_PREFIX = "event-";
export const SCHEDULE_X_TASK_PREFIX = "task-";

export type ScheduleXEventId =
  | { kind: "event"; id: Id<"calendarEvents"> }
  | { kind: "task"; id: Id<"tasks"> };

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
  if (raw.startsWith(SCHEDULE_X_TASK_PREFIX)) {
    return {
      kind: "task",
      id: raw.slice(SCHEDULE_X_TASK_PREFIX.length) as Id<"tasks">,
    };
  }
  return null;
}

export function formatScheduleXEventId(parsed: ScheduleXEventId): string {
  return parsed.kind === "event"
    ? `${SCHEDULE_X_EVENT_PREFIX}${parsed.id}`
    : `${SCHEDULE_X_TASK_PREFIX}${parsed.id}`;
}
