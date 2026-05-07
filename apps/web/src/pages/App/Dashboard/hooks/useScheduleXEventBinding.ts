/**
 * ─────────────────────────────────────────────────────────────────────
 * SCHEDULE-X v4 PRIVATE-STATE QUARANTINE ZONE
 * ─────────────────────────────────────────────────────────────────────
 *
 * This file is the only place in the dashboard codebase that:
 *   • diffs React-state event arrays against schedule-x's internal
 *     events store via `calendarApp.events.add/update/remove/getAll`,
 *   • reaches into schedule-x's private singleton at
 *     `(calendarApp as unknown as { $app: { calendarEvents:
 *     { backgroundEvents: { value } } } })` to push background events
 *     (the public events API has no background-events mutator at v4.5).
 *
 * Why a quarantine: schedule-x's calendar core sits at v4 but the
 * drag/resize plugins are still v3.7.x, and there's no roadmap for a
 * v4 background-events public API. When schedule-x ships a public
 * mutator (or a v5 calendar core lands), this is the ONLY file that
 * needs touching — both the diff loop and the private cast move
 * together.
 *
 * Do not duplicate either pattern elsewhere; route new lanes (cycles,
 * holidays, etc.) through this hook by extending the inputs.
 *
 * Audit pointer: PRD GitHub issue #1, user story 8.
 */

import { useEffect, useRef } from "react";
import {
  CalendarApp,
  type BackgroundEvent,
  type CalendarEventExternal,
} from "@schedule-x/calendar";

/**
 * Minimum shape this hook reads off each foreground event. Matches
 * schedule-x's `CalendarEventExternal` for the fields we diff on, but
 * declared structurally so the parent can pass through extra metadata
 * (`_kind`, `_taskProjectId`, …) without an explicit pick/omit.
 */
export type BindableEvent = Pick<
  CalendarEventExternal,
  "id" | "title" | "start" | "end" | "calendarId"
>;

export type UseScheduleXEventBindingArgs = {
  /** Schedule-x calendar instance (return value of `createCalendar`). */
  calendarApp: CalendarApp;
  /** Foreground events — tasks + calendar events the viewer sees as cards. */
  events: BindableEvent[];
  /**
   * Background events — busy-blocks for member-calendar overlays. Pass
   * `[]` (not `undefined`) to clear the lane.
   */
  backgroundEvents: BackgroundEvent[];
};

/**
 * Type alias for the schedule-x v4 private singleton accessor. Pinned
 * here in one place so the cast site below reads cleanly and a future
 * upgrade can grep this name to find every consumer.
 */
type ScheduleXPrivateBackgroundEventsHandle = {
  $app: {
    calendarEvents: {
      backgroundEvents: { value: BackgroundEvent[] };
    };
  };
};

/**
 * Pushes the background-events array into schedule-x's internal preact
 * signal. Lifted to module scope deliberately: this is the only path
 * that mutates a property of the calendar app, and the React Compiler's
 * `react-hooks/immutability` rule (correctly) flags property writes on
 * hook-arg objects as render-unsafe. Routing the write through an
 * opaque module-level function makes it explicit that this is a
 * boundary-crossing call into schedule-x's interior, not a pattern
 * other hooks should copy.
 */
function pushBackgroundEvents(
  calendarApp: CalendarApp,
  next: BackgroundEvent[],
): void {
  const handle = calendarApp as unknown as ScheduleXPrivateBackgroundEventsHandle;
  handle.$app.calendarEvents.backgroundEvents.value = next;
}

/**
 * Synchronises React-state event arrays into a schedule-x calendar
 * instance. Fire-and-forget — returns nothing. Effects are gated by
 * stringified-content keys so the loops are O(1) on no-op renders.
 *
 * Foreground events: schedule-x's public events facade is per-event
 * (add/update/remove). We maintain the delta ourselves keyed off
 * `(id, start, end, title, calendarId)` — Temporal start/end values
 * stringify to a stable ISO form so `toString()` is a sound equality
 * key.
 *
 * Background events: no public mutator exists at schedule-x v4.5, so
 * we assign directly to the internal preact signal holding the array.
 * This is the ONLY place the private cast lives — see the file header.
 */
export function useScheduleXEventBinding({
  calendarApp,
  events,
  backgroundEvents,
}: UseScheduleXEventBindingArgs): void {
  const eventsKeyRef = useRef("");
  useEffect(() => {
    const key = events
      .map(
        (e) =>
          `${String(e.id)}|${e.start.toString()}|${e.end.toString()}|${e.title}|${e.calendarId ?? ""}`,
      )
      .join(",");
    if (key === eventsKeyRef.current) return;
    eventsKeyRef.current = key;

    const existing = calendarApp.events.getAll();
    const existingIds = new Set(existing.map((e) => String(e.id)));
    const incomingIds = new Set(events.map((e) => String(e.id)));
    for (const id of existingIds) {
      if (!incomingIds.has(id)) calendarApp.events.remove(id);
    }
    for (const e of events) {
      const idStr = String(e.id);
      if (!existingIds.has(idStr)) {
        calendarApp.events.add(e);
      } else {
        const prev = existing.find((x) => String(x.id) === idStr);
        if (
          prev &&
          (String(prev.start) !== e.start.toString() ||
            String(prev.end) !== e.end.toString() ||
            prev.title !== e.title ||
            prev.calendarId !== e.calendarId)
        ) {
          calendarApp.events.update(e);
        }
      }
    }
  }, [calendarApp, events]);

  const bgEventsKeyRef = useRef("");
  useEffect(() => {
    const key = backgroundEvents
      .map(
        (e) =>
          `${String(e.start)}|${String(e.end)}|${(e.style as Record<string, string> | undefined)?.background ?? ""}`,
      )
      .join(",");
    if (key === bgEventsKeyRef.current) return;
    bgEventsKeyRef.current = key;

    // Schedule-x v4 private-state push — the only place this codebase
    // assigns to `$app.calendarEvents.backgroundEvents.value`. See the
    // file header for the v4 quarantine rationale.
    pushBackgroundEvents(calendarApp, backgroundEvents);
  }, [calendarApp, backgroundEvents]);
}
