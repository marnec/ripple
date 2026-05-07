import { useState } from "react";

import {
  DAY_MINUTES,
  SLOT_MINUTES,
} from "../../Calendar/calendar-grid-constants";

/**
 * Pixel threshold separating a click from a drag. Sits below typical
 * click jitter so resting-finger micro-movements still register as a
 * click; anything more is treated as a drag-to-create.
 *
 * Pinned by the renderHook test; bumping this value will require
 * updating the test alongside it (intentional — the pin is the contract).
 */
const CLICK_DRAG_THRESHOLD_PX = 4;

/**
 * State machine for the dashboard's drag-to-create surface.
 *
 *   • `dragging` — mouse is down, ghost grows with cursor on mousemove.
 *   • `creating` — mouse released past the click/drag threshold; the
 *     popover form is mounted and the user is filling it in.
 *
 * `dayColumn` is the schedule-x time-grid column DOM node — kept on the
 * state so the popover can anchor to it without re-querying the DOM.
 */
export type CreatorState = {
  phase: "dragging" | "creating";
  dayColumn: HTMLElement;
  startMs: number;
  endMs: number;
  /** Mouse-down coords for the click-vs-drag decision at mouseup. */
  downX: number;
  downY: number;
};

export type BeginCreatorInit = {
  dayColumn: HTMLElement;
  downX: number;
  downY: number;
};

export type UseEventDragCreateResult = {
  creator: CreatorState | null;
  /**
   * Begin a drag-to-create gesture. MUST be called synchronously from
   * the originating mousedown handler — it attaches document-level
   * `mousemove`/`mouseup` listeners in-line so a fast click (mouseup
   * within 0–10 ms) can't beat React's effect commit. Returning early
   * (e.g. column has no `data-time-grid-date` attribute) leaves the
   * creator state untouched.
   */
  beginCreator: (init: BeginCreatorInit) => void;
  /** Tear down the creator (popover dismissed / form submitted / cancelled). */
  dismissCreator: () => void;
  /** Update the times of an in-flight creator (popover form edits). */
  setCreatorTimes: (startMs: number, endMs: number) => void;
};

/**
 * Owns the drag-to-create state machine for the dashboard calendar's
 * time-grid surface.
 *
 * Why this is a hook (not inline in MyCalendarTab):
 *   • The synchronous-document-listener trick (mousemove/mouseup
 *     attached during the originating mousedown rather than via a
 *     `useEffect` keyed on phase) is a load-bearing detail — schedule-x's
 *     `onMouseDownDateTime` runs inside its preact event handler; React
 *     batches our setState and may not flush + commit + run effects
 *     before the matching mouseup fires for a fast click. Encapsulating
 *     the trick keeps it from being accidentally "improved" into an
 *     effect.
 *   • The 4 px click-vs-drag threshold and the snap-to-15-min math are
 *     the rules MyCalendarTab promises to its users; pinning them with
 *     renderHook tests beats relying on manual QA.
 *   • The base-ui Popover-from-mouseup race fix (capture-phase
 *     `stopImmediatePropagation` on the trailing `click`) lives here so
 *     the parent can't forget to wire it.
 *
 * @param onCreate Called when the gesture transitions from `dragging`
 * into `creating` — i.e. the user has committed a slot. Currently
 * unused (the popover renders directly off `creator`); reserved so
 * future surfaces can react to commit without diffing the state shape.
 */
export function useEventDragCreate(): UseEventDragCreateResult {
  const [creator, setCreator] = useState<CreatorState | null>(null);

  function beginCreator(init: BeginCreatorInit) {
    const { dayColumn, downX, downY } = init;
    const colDateStr = dayColumn.getAttribute("data-time-grid-date");
    if (!colDateStr) return;
    const dayStartMs = new Date(`${colDateStr}T00:00`).getTime();
    if (Number.isNaN(dayStartMs)) return;

    function cursorYToEpochMs(clientY: number): number {
      const colRect = dayColumn.getBoundingClientRect();
      const offsetY = Math.max(
        0,
        Math.min(colRect.height, clientY - colRect.top),
      );
      const minutesRaw = (offsetY / colRect.height) * DAY_MINUTES;
      // Snap to the shared SLOT_MINUTES grid so the ghost lands on a
      // TimeSelect-valid option (the form's pickers don't expose finer
      // steps). All three of MyCalendarTab's drag-create math, the
      // CursorTimeIndicator hover hint, and InlineEventCreator's ghost
      // geometry must agree on this granularity — see
      // calendar-grid-constants.ts.
      const minutes = Math.max(
        0,
        Math.min(
          DAY_MINUTES,
          Math.round(minutesRaw / SLOT_MINUTES) * SLOT_MINUTES,
        ),
      );
      return dayStartMs + minutes * 60 * 1000;
    }

    // Derive the start from the cursor Y rather than schedule-x's
    // `dateTime.epochMilliseconds` — schedule-x's value is computed at
    // its `timePointsPerDay` resolution (1-min by default) and would
    // land on whatever exact pixel the user clicked. Using
    // `cursorYToEpochMs` snaps to the same SLOT_MINUTES grid the
    // `<CursorTimeIndicator />` displays, so the ghost that appears on
    // mouseup starts exactly where the hover hint promised.
    const startMs = cursorYToEpochMs(downY);

    function onMove(e: MouseEvent) {
      const newEndMs = cursorYToEpochMs(e.clientY);
      setCreator((prev) =>
        prev && prev.phase === "dragging"
          ? { ...prev, endMs: newEndMs }
          : prev,
      );
    }

    function onUp(e: MouseEvent) {
      // Detach immediately so the same drag can't accidentally fire
      // twice (defensive — mouseup is normally one-shot).
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      // Swallow the `click` event that follows this mouseup. base-ui's
      // Popover uses floating-ui's `useDismiss` with
      // `outsidePressEvent: 'intentional'`, which registers a
      // capture-phase `click` listener on the document that fires
      // `onOpenChange(false)` when the click target is outside the
      // popup. The popup mounts in a React microtask between this
      // mouseup and the browser's `click` dispatch — meaning the click
      // we generated by ending the drag is interpreted as an
      // outside-press dismiss the moment the popup appears, closing it
      // before the user can see it.
      //
      // Suppression mechanics:
      //   - We register on `document` in capture phase, BEFORE base-ui
      //     gets a chance to (its registration runs in the `useEffect`
      //     that fires after render commit, which happens after this
      //     synchronous code finishes).
      //   - `stopImmediatePropagation` prevents other capture-phase
      //     listeners on the same node — including base-ui's — from
      //     running. `stopPropagation` alone wouldn't, since multiple
      //     capture listeners on the same element fire in registration
      //     order regardless of bubbling.
      //   - One-shot self-removal: even if no click follows (rare,
      //     e.g. drag ends with a focus change), the listener is
      //     cleaned up after the next click anywhere on the page.
      function suppressNextClick(ev: MouseEvent) {
        ev.stopImmediatePropagation();
        document.removeEventListener("click", suppressNextClick, true);
      }
      document.addEventListener("click", suppressNextClick, true);

      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      const isClick =
        dx < CLICK_DRAG_THRESHOLD_PX && dy < CLICK_DRAG_THRESHOLD_PX;
      setCreator((prev) => {
        if (!prev || prev.phase !== "dragging") return prev;
        let nextStart = startMs;
        let nextEnd = isClick
          ? // Click-to-create: same SLOT_MINUTES ghost the drag preview
            // shows. Avoids the visual "jump" from 15 min during the
            // press to 60 min on release; users who want a longer event
            // drag the slot or extend the end picker.
            startMs + SLOT_MINUTES * 60 * 1000
          : prev.endMs;
        if (!isClick && nextEnd <= nextStart) {
          // Dragged upward — swap so start < end. Without this the ghost
          // rect would have negative height and the form's submit logic
          // would treat it as "spans midnight" — wrong semantic for a
          // same-day selection.
          [nextStart, nextEnd] = [nextEnd, nextStart];
        }
        if (!isClick && nextEnd - nextStart < SLOT_MINUTES * 60 * 1000) {
          // Drag-distance < one slot — snap to a single-slot ghost
          // rather than producing a sub-15-min event the form can't
          // represent cleanly.
          nextEnd = nextStart + SLOT_MINUTES * 60 * 1000;
        }
        return {
          ...prev,
          phase: "creating" as const,
          startMs: nextStart,
          endMs: nextEnd,
        };
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    setCreator({
      phase: "dragging",
      dayColumn,
      startMs,
      // Seed `endMs` at start + SLOT_MINUTES so the ghost is visible on
      // the very first frame; the first mousemove tick overrides it.
      endMs: startMs + SLOT_MINUTES * 60 * 1000,
      downX,
      downY,
    });
  }

  function dismissCreator() {
    setCreator(null);
  }

  function setCreatorTimes(startMs: number, endMs: number) {
    setCreator((prev) => (prev ? { ...prev, startMs, endMs } : prev));
  }

  return { creator, beginCreator, dismissCreator, setCreatorTimes };
}
