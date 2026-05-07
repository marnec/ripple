import { useEffect, useRef } from "react";

import type { Id } from "@convex/_generated/dataModel";

import { parseScheduleXEventId } from "../../Calendar/scheduleXEventId";

/** CSS class on the dashboard's `<ScheduleXCalendar>` wrapper element.
 *  Used to scope this resolver's listeners to the dashboard calendar
 *  only (the project calendar mounts its own schedule-x instance and
 *  uses the same `data-event-id` attribute on its event divs). */
const SX_WRAPPER_CLASS = "sx-react-calendar-wrapper";

/** 4 px click-vs-drag threshold — same value pinned by
 *  `useEventDragCreate`, kept in sync deliberately. */
const CLICK_DRAG_THRESHOLD_PX = 4;

/** Narrow shape of a task we read from the tasks list — only
 *  `_id` + `projectId` are needed to look up the project a clicked
 *  task belongs to. Declared structurally so tests / non-Convex
 *  callers can pass a minimal stub. */
export type ResolvableTask = {
  _id: Id<"tasks">;
  projectId: Id<"projects">;
};

export type UseEventClickResolutionArgs = {
  /** Tasks list — read on every mouseup so a click on a task event
   *  can route to the right project. May be undefined while loading. */
  tasks: ResolvableTask[] | undefined;
  /** Fired when the user clicks a `task-*` event. */
  onTaskClick: (
    taskId: Id<"tasks">,
    projectId: Id<"projects"> | null,
  ) => void;
  /** Fired when the user clicks an `event-*` event. */
  onEventClick: (eventId: Id<"calendarEvents">) => void;
};

/**
 * Document-level capture-phase resolver for schedule-x event clicks
 * inside the dashboard calendar.
 *
 * Why this isn't `onEventClick` on the schedule-x callback config:
 * schedule-x v4's `onEventClick` is dispatched via a preact synthetic
 * `onClick` on a div that the v3 drag plugin's `updateCopy(undefined)`
 * call removes from the DOM during the mouseup async path. That race
 * leaves clicks undelivered for full-width (solo) time-grid events.
 *
 * Resolution timing — IMPORTANT: we resolve the event id at
 * `mousedown` and dispatch directly from `mouseup`, ignoring `click`
 * entirely.
 *
 * Why mousedown is the only safe resolution point:
 * - At 150 ms of hold the calendar mounts a "copy" event div (sibling
 *   of the original) for the drag preview. The copy carries the same
 *   `data-event-id` and lands on top of the original for solo events.
 * - On mouseup the v3 plugin's document mouseup handler calls
 *   `updateCopy(undefined)` which detaches the copy via Preact
 *   re-render before the browser dispatches the synthetic `click`.
 * - When mouseup target ≠ mousedown target AND one of them is
 *   detached at click-dispatch time, browsers may skip `click`
 *   entirely (or fire it on a common ancestor that lacks
 *   `data-event-id`). Either way `click` cannot be relied on.
 * - Even at mouseup the target can already be a detached copy:
 *   `closest('[data-event-id]')` still returns the copy (the
 *   attribute is preserved) but `closest('.sx-react-calendar-wrapper')`
 *   walks up from a detached node and returns null.
 * - At mousedown the copy doesn't exist yet — the 150 ms drag-start
 *   timer hasn't fired. The target is unambiguously the original event
 *   div, attached, with a clean ancestor chain.
 *
 * Drag-vs-click filter: if mouseup moved > 4 px from mousedown we treat
 * it as a drag artefact and no-op (the drag plugin's `onEventUpdate`
 * handles persistence).
 *
 * Side concern: dragstart suppression. The time-grid event div has no
 * `draggable` attribute (unlike date-grid / month-grid events, which
 * DO use HTML5 native drag intentionally), so any dragstart originating
 * inside `.sx__time-grid-event` is the browser starting a text-drag on
 * selected text. Browsers suppress `mousemove` during native drag,
 * which means the v3 drag plugin's mousemove listener never fires and
 * the event copy stops following the cursor — the visible symptom is
 * "text follows cursor but the event block stays still". Cancelling
 * dragstart here lets the mouse-event drag flow through unimpaired. We
 * must NOT cancel dragstart for date-grid / month-grid events: those
 * rely on HTML5 dragend for their drag commit.
 */
export function useEventClickResolution({
  tasks,
  onTaskClick,
  onEventClick,
}: UseEventClickResolutionArgs): void {
  // Refs trampoline — listeners attach once on mount and read fresh
  // values on each call. Keeps the [] deps array honest (the
  // listeners don't need re-attaching when tasks update).
  const tasksRef = useRef(tasks);
  const onTaskClickRef = useRef(onTaskClick);
  const onEventClickRef = useRef(onEventClick);
  useEffect(() => {
    tasksRef.current = tasks;
    onTaskClickRef.current = onTaskClick;
    onEventClickRef.current = onEventClick;
  });

  useEffect(() => {
    let downX = 0;
    let downY = 0;
    let downEventId: string | null = null;

    function handleMouseDown(e: MouseEvent) {
      downX = e.clientX;
      downY = e.clientY;
      downEventId = null;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Skip resize handles. The handle covers the bottom 20 px of
      // every event; small resize gestures may snap to the same time
      // slot and end with movement < 4 px, which would otherwise trip
      // the click-vs-drag check below and open the sheet on top of a
      // successful resize.
      if (
        target.closest(
          ".sx__time-grid-event-resize-handle, .sx__date-grid-event-resize-handle",
        )
      ) {
        return;
      }
      const eventEl = target.closest<HTMLElement>("[data-event-id]");
      if (!eventEl) return;
      // Only react to events inside the dashboard's own calendar
      // wrapper — the project calendar (and any other schedule-x
      // instance mounted simultaneously) also uses `data-event-id`,
      // and we don't want to hijack their clicks.
      if (!eventEl.closest(`.${SX_WRAPPER_CLASS}`)) return;
      downEventId = eventEl.getAttribute("data-event-id");
    }

    function handleMouseUp(e: MouseEvent) {
      const id = downEventId;
      downEventId = null;
      if (!id) return;
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > CLICK_DRAG_THRESHOLD_PX || dy > CLICK_DRAG_THRESHOLD_PX) return;
      const parsed = parseScheduleXEventId(id);
      if (parsed?.kind === "task") {
        const match = tasksRef.current?.find((t) => t._id === parsed.id);
        onTaskClickRef.current(parsed.id, match?.projectId ?? null);
      } else if (parsed?.kind === "event") {
        onEventClickRef.current(parsed.id);
      }
    }

    function handleDragStart(e: DragEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(`.${SX_WRAPPER_CLASS}`)) return;
      if (target.closest(".sx__time-grid-event")) {
        e.preventDefault();
      }
    }

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("dragstart", handleDragStart, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("dragstart", handleDragStart, true);
    };
  }, []);
}
