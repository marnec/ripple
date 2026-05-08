import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEventDragCreate } from "./useEventDragCreate";

// SLOT_MINUTES is 15 in calendar-grid-constants. The hook claims that
// minute = round((y / height) * 1440 / 15) * 15. We assert against that
// formula directly rather than re-importing the constant — the contract
// the parent surface relies on is the snap result, not the constant
// name. If SLOT_MINUTES ever changes, the explicit values below catch
// the change.
const DAY_DATE = "2026-05-04"; // Monday
const COL_HEIGHT_PX = 1440; // 1 px per minute → easy mental math
const COL_TOP_PX = 100;
const COL_LEFT_PX = 0;

/**
 * Build a stub time-grid column DOM node with `data-time-grid-date`,
 * a fixed `getBoundingClientRect`, and append it to `document.body`
 * so document-level listeners attached by the hook fire on synthetic
 * MouseEvents dispatched at it. Caller is responsible for cleanup
 * (handled by the global `afterEach`).
 */
function makeDayColumn(dateStr: string = DAY_DATE): HTMLElement {
  const col = document.createElement("div");
  col.setAttribute("data-time-grid-date", dateStr);
  const rect: DOMRect = {
    top: COL_TOP_PX,
    left: COL_LEFT_PX,
    bottom: COL_TOP_PX + COL_HEIGHT_PX,
    right: COL_LEFT_PX + 100,
    width: 100,
    height: COL_HEIGHT_PX,
    x: COL_LEFT_PX,
    y: COL_TOP_PX,
    toJSON: () => ({}),
  };
  col.getBoundingClientRect = () => rect;
  document.body.appendChild(col);
  return col;
}

/** Day-start epoch ms for the local-zone parsing the hook uses. */
function dayStartMs(dateStr: string = DAY_DATE): number {
  return new Date(`${dateStr}T00:00`).getTime();
}

/** Fire a real MouseEvent so the hook's document-level listeners
 *  receive it (synthetic React events would bypass them). */
function fireMouse(
  type: "mousemove" | "mouseup" | "click",
  init: { clientX: number; clientY: number },
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: 0,
  });
  document.dispatchEvent(ev);
  return ev;
}

afterEach(() => {
  // Strip any columns left behind plus stray document listeners
  // attached by tests that didn't end with a mouseup. Re-rendering
  // the test-id'd hook would otherwise inherit dangling listeners
  // and one test could perturb another.
  document.body.innerHTML = "";
});

describe("useEventDragCreate", () => {
  it("starts in idle state with creator=null", () => {
    const { result } = renderHook(() => useEventDragCreate());
    expect(result.current.creator).toBeNull();
  });

  it("returns early without mutating state when the day column is missing data-time-grid-date", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const naked = document.createElement("div");
    document.body.appendChild(naked);

    act(() => {
      result.current.beginCreator({ dayColumn: naked, downX: 50, downY: 200 });
    });

    expect(result.current.creator).toBeNull();
  });

  it("snaps the start time to the 15-min grid based on cursor Y (not pixel-precise)", () => {
    // 1 px = 1 minute (height = 1440). Click at y = 100 + 23 → 23 min
    // raw → snaps to nearest 15 → 30 min after midnight (round half-up).
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();

    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 23,
      });
    });

    expect(result.current.creator).not.toBeNull();
    expect(result.current.creator?.phase).toBe("dragging");
    // 23 min → round(23/15)*15 = round(1.533)*15 = 2*15 = 30 min
    expect(result.current.creator?.startMs).toBe(
      dayStartMs() + 30 * 60 * 1000,
    );
    // Drag-phase ghost seeded at start + 15 min so it's visible on
    // the very first frame before mousemove tick lands.
    expect(result.current.creator?.endMs).toBe(
      dayStartMs() + 45 * 60 * 1000,
    );
  });

  it("snaps to multiple expected slot boundaries across the day", () => {
    const cases: Array<{ downY: number; expectedMinute: number }> = [
      // y_offset → raw_min → snapped_min
      { downY: COL_TOP_PX + 0, expectedMinute: 0 }, // 0 → 0
      { downY: COL_TOP_PX + 7, expectedMinute: 0 }, // round(7/15)*15 = 0
      { downY: COL_TOP_PX + 8, expectedMinute: 15 }, // round(8/15)*15 = 15
      { downY: COL_TOP_PX + 60, expectedMinute: 60 }, // 60 → 60
      { downY: COL_TOP_PX + 547, expectedMinute: 540 }, // round(547/15)*15 = 540 (9:00 AM)
      { downY: COL_TOP_PX + 1439, expectedMinute: 1440 }, // clamped to DAY_MINUTES
    ];

    for (const { downY, expectedMinute } of cases) {
      const { result, unmount } = renderHook(() => useEventDragCreate());
      const col = makeDayColumn();

      act(() => {
        result.current.beginCreator({ dayColumn: col, downX: 50, downY });
      });

      expect(result.current.creator?.startMs).toBe(
        dayStartMs() + expectedMinute * 60 * 1000,
      );

      // Resolve the gesture to clean up document listeners between
      // sub-cases. mouseup at the same coords keeps it a click.
      act(() => {
        fireMouse("mouseup", { clientX: 50, clientY: downY });
      });
      unmount();
      document.body.innerHTML = "";
    }
  });

  it("treats mousedown + mouseup with no movement as a click — does not advance to creating phase before mouseup, then commits a single-slot ghost", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();
    // y = COL_TOP + 75 → 75 min raw → snaps to 75 (15-aligned).
    const downY = COL_TOP_PX + 75;
    const downX = 50;

    act(() => {
      result.current.beginCreator({ dayColumn: col, downX, downY });
    });
    expect(result.current.creator?.phase).toBe("dragging");

    // Mouseup at the exact same coordinates → click branch.
    act(() => {
      fireMouse("mouseup", { clientX: downX, clientY: downY });
    });

    expect(result.current.creator?.phase).toBe("creating");
    // Click-to-create produces a single-slot ghost (start, start + 15 min)
    // — no jump to a 60-min event on release.
    const expectedStart = dayStartMs() + 75 * 60 * 1000;
    expect(result.current.creator?.startMs).toBe(expectedStart);
    expect(result.current.creator?.endMs).toBe(expectedStart + 15 * 60 * 1000);
  });

  it("classifies movement under the 4 px threshold as a click (not a drag)", () => {
    // 3 px in both axes — under the 4 px threshold the hook pins.
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();
    const downX = 50;
    const downY = COL_TOP_PX + 75;

    act(() => {
      result.current.beginCreator({ dayColumn: col, downX, downY });
    });
    act(() => {
      fireMouse("mouseup", { clientX: downX + 3, clientY: downY + 3 });
    });

    // Click branch — single-slot ghost, not the dragged-end value.
    const expectedStart = dayStartMs() + 75 * 60 * 1000;
    expect(result.current.creator?.endMs).toBe(expectedStart + 15 * 60 * 1000);
  });

  it("classifies movement past the 4 px threshold as a drag and commits to the snapped end", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();
    const downX = 50;
    const downY = COL_TOP_PX + 60; // 1:00 AM
    // Drag down by 130 px → raw 130 min → snaps to 135 (round(190/15)=13 → 195? recomputed below)
    // Actually: end_y = downY + 130 = COL_TOP + 190 → 190 min raw → round(190/15)*15 = 195.
    const moveY = downY + 130;

    act(() => {
      result.current.beginCreator({ dayColumn: col, downX, downY });
    });

    act(() => {
      fireMouse("mousemove", { clientX: downX, clientY: moveY });
    });

    act(() => {
      // 5 px X-shift → past the 4 px threshold → drag branch.
      fireMouse("mouseup", { clientX: downX + 5, clientY: moveY });
    });

    expect(result.current.creator?.phase).toBe("creating");
    expect(result.current.creator?.startMs).toBe(
      dayStartMs() + 60 * 60 * 1000,
    );
    expect(result.current.creator?.endMs).toBe(
      dayStartMs() + 195 * 60 * 1000,
    );
  });

  it("swaps start/end when the user drags upward past the threshold", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();
    const downX = 50;
    const downY = COL_TOP_PX + 300; // 5:00 AM
    const moveY = downY - 120; // 3:00 AM (snaps to 180 min)

    act(() => {
      result.current.beginCreator({ dayColumn: col, downX, downY });
    });
    act(() => {
      fireMouse("mousemove", { clientX: downX, clientY: moveY });
    });
    act(() => {
      fireMouse("mouseup", { clientX: downX + 10, clientY: moveY });
    });

    // Swapped: start=180 min, end=300 min.
    expect(result.current.creator?.startMs).toBe(
      dayStartMs() + 180 * 60 * 1000,
    );
    expect(result.current.creator?.endMs).toBe(
      dayStartMs() + 300 * 60 * 1000,
    );
  });

  it("dismissCreator resets state so a follow-up gesture works", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();

    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 60,
      });
    });
    act(() => {
      fireMouse("mouseup", { clientX: 50, clientY: COL_TOP_PX + 60 });
    });
    expect(result.current.creator?.phase).toBe("creating");

    act(() => {
      result.current.dismissCreator();
    });
    expect(result.current.creator).toBeNull();

    // A new gesture on a (possibly different) column should seed
    // afresh, not inherit the prior creating-phase state.
    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 90, // 1:30 AM
      });
    });
    expect(result.current.creator?.phase).toBe("dragging");
    expect(result.current.creator?.startMs).toBe(
      dayStartMs() + 90 * 60 * 1000,
    );
  });

  it("setCreatorTimes overrides start/end without changing phase", () => {
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();

    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 60,
      });
    });
    act(() => {
      fireMouse("mouseup", { clientX: 50, clientY: COL_TOP_PX + 60 });
    });

    const newStart = dayStartMs() + 9 * 60 * 60 * 1000; // 9:00 AM
    const newEnd = dayStartMs() + 10 * 60 * 60 * 1000; // 10:00 AM

    act(() => {
      result.current.setCreatorTimes(newStart, newEnd);
    });

    expect(result.current.creator?.phase).toBe("creating");
    expect(result.current.creator?.startMs).toBe(newStart);
    expect(result.current.creator?.endMs).toBe(newEnd);
  });

  it("treats a beginCreator call while in creating phase as an outside-press dismiss (no new drag, popover closes)", () => {
    // Bug repro: with the popover open, mousedowning on the time grid
    // used to start a fresh drag-create whose mouseup re-committed the
    // popover at the new coordinates — so the popover appeared to hop
    // around rather than close. Calling `beginCreator` while a
    // "creating"-phase creator exists must instead clear it and return
    // without registering listeners.
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();

    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 60,
      });
    });
    act(() => {
      fireMouse("mouseup", { clientX: 50, clientY: COL_TOP_PX + 60 });
    });
    expect(result.current.creator?.phase).toBe("creating");

    // Second gesture begins while the popover is open — should dismiss
    // the existing creator instead of seeding a new one.
    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 600,
      });
    });
    expect(result.current.creator).toBeNull();

    // No mousemove/mouseup listeners should have been re-registered —
    // a stray mouseup must not be able to resurrect the creator.
    act(() => {
      fireMouse("mouseup", { clientX: 50, clientY: COL_TOP_PX + 600 });
    });
    expect(result.current.creator).toBeNull();
  });

  it("registers a one-shot capture-phase click suppressor on mouseup so the trailing click is swallowed", () => {
    // Re-prove the base-ui Popover-from-mouseup race fix: any
    // capture-phase document `click` listener registered AFTER the
    // hook's mouseup runs must NOT see the trailing click event.
    const lateListener = vi.fn();
    const { result } = renderHook(() => useEventDragCreate());
    const col = makeDayColumn();

    act(() => {
      result.current.beginCreator({
        dayColumn: col,
        downX: 50,
        downY: COL_TOP_PX + 60,
      });
    });
    act(() => {
      fireMouse("mouseup", { clientX: 50, clientY: COL_TOP_PX + 60 });
    });

    // Register a *late* capture-phase click listener — same registration
    // order base-ui's Popover would land in (its useEffect runs after
    // render commit, well after our mouseup). The hook's suppressor
    // was registered synchronously inside the mouseup handler, so it
    // fires first and `stopImmediatePropagation` prevents this one
    // from running.
    document.addEventListener("click", lateListener, true);
    fireMouse("click", { clientX: 50, clientY: COL_TOP_PX + 60 });
    document.removeEventListener("click", lateListener, true);

    expect(lateListener).not.toHaveBeenCalled();
  });
});
