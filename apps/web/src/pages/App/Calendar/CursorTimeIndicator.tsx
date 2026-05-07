import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// 15-min snap math — must mirror `beginCreator`'s `cursorYToEpochMs` in
// MyCalendarTab so the visual hint and the click-to-create result land
// on the exact same slot. If you change one, change both.
// ────────────────────────────────────────────────────────────────────────

const SLOT_MIN = 15;
const DAY_MIN = 24 * 60;

type IndicatorState = {
  /** schedule-x time-grid day column the cursor is over. */
  dayColumn: HTMLElement;
  /** Snapped offset (minutes from local midnight) within that column. */
  offsetMin: number;
  /** Resolved viewport position of the snapped slot, computed from
   *  the column's bounding rect at the moment this state was built.
   *  Stored explicitly (rather than re-read in render) so the bar's
   *  pixel coords always come from the same layout snapshot the
   *  `offsetMin` was derived from. Re-reading
   *  `dayColumn.getBoundingClientRect()` at render time was the
   *  source of the post-scroll drift bug: the state-computation
   *  read and the render read could observe different layouts when
   *  scroll fired between them, so the bar's `top` lagged the
   *  cursor by exactly the scroll delta. */
  top: number;
  left: number;
  width: number;
};

/** Map a viewport mouse position to a snapped time-grid slot, or
 *  return `null` when the cursor isn't over an empty time-grid cell.
 *  We hide the hint over existing events because clicking one opens
 *  the detail sheet — the "+ create" affordance there is misleading.
 *  Takes raw `clientX/Y` rather than a `MouseEvent` so the same logic
 *  can be re-run from a scroll handler using the last cursor coords. */
function computeIndicatorState(
  clientX: number,
  clientY: number,
): IndicatorState | null {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-event-id]")) return null;
  const col = target.closest<HTMLElement>("[data-time-grid-date]");
  if (!col) return null;
  // Make sure we're inside our own dashboard calendar — the project
  // calendar (and any other schedule-x instance mounted in the page)
  // also uses `data-time-grid-date`, and we don't want this hint
  // bleeding over there.
  if (!col.closest(".sx-react-calendar-wrapper")) return null;
  const colRect = col.getBoundingClientRect();
  if (colRect.height <= 0) return null;
  const offsetY = clientY - colRect.top;
  const pxPerMin = colRect.height / DAY_MIN;
  const minutesRaw = offsetY / pxPerMin;
  // Round to the nearest 15-min boundary so the line jumps slot-by-slot
  // instead of pixel-by-pixel — that's the visual contract that makes
  // "where the line is" match "where the ghost will start".
  const offsetMin = Math.max(
    0,
    Math.min(DAY_MIN - SLOT_MIN, Math.round(minutesRaw / SLOT_MIN) * SLOT_MIN),
  );
  // Resolve the viewport coords here, against the same `colRect` that
  // produced `offsetMin`. The render uses these directly — no second
  // `getBoundingClientRect` call, no chance of layout drift between
  // computation and paint.
  const top = colRect.top + offsetMin * pxPerMin;
  return {
    dayColumn: col,
    offsetMin,
    top,
    left: colRect.left,
    width: colRect.width,
  };
}

export type CursorTimeIndicatorProps = {
  /** Whether the indicator should be tracking. Pass `false` during an
   *  active drag-to-create or while the create popover is open — the
   *  ghost takes over the visual role and the indicator would just be
   *  noise. Toggling this off detaches the document mousemove
   *  listener entirely (no per-frame work while the popover is up). */
  active: boolean;
};

/**
 * "Click here to create" hover hint for the calendar's time grid.
 * Mirrors the visual language of schedule-x's current-time line — a
 * horizontal bar across the day column with a pill anchored to the
 * leading edge — but uses a primary-colored pill containing a `+`
 * icon to communicate "this is a creation affordance".
 *
 * Position is fixed-positioned over the calendar via the column's
 * viewport rect, so it survives schedule-x's internal scroll
 * container without us having to splice into its DOM.
 */
export function CursorTimeIndicator({ active }: CursorTimeIndicatorProps) {
  const [state, setState] = useState<IndicatorState | null>(null);
  // Cached last-seen cursor coords. Refreshed on every mousemove and
  // read by the scroll handler — pure scrolling doesn't fire
  // mousemove (the cursor's viewport position doesn't change), so
  // without this we'd be unable to recompute the snap when the column
  // moves under a stationary cursor.
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    // Bail-out-friendly setter shared by both the mousemove and
    // scroll paths so a smooth-moving cursor doesn't re-render the
    // indicator at every tick — only when something visually
    // observable changed. The position fields (top/left/width) are
    // part of the equality check too: when the user scrolls without
    // crossing a snap boundary, `offsetMin` stays the same but the
    // column's viewport position has shifted, so `top` differs and
    // a re-render is required. Without this, the bar would freeze
    // at its pre-scroll viewport coords.
    function applyState(next: IndicatorState | null) {
      setState((prev) => {
        if (!next && !prev) return prev;
        if (!next || !prev) return next;
        if (
          prev.dayColumn === next.dayColumn &&
          prev.offsetMin === next.offsetMin &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width
        ) {
          return prev;
        }
        return next;
      });
    }
    function onMove(e: MouseEvent) {
      lastCursorRef.current = { x: e.clientX, y: e.clientY };
      applyState(computeIndicatorState(e.clientX, e.clientY));
    }
    function onScroll() {
      // Recompute against the cached cursor — without this, scrolling
      // (page or schedule-x's internal time-grid scroller) moves the
      // column under a stationary cursor and the snapped offset (and
      // therefore the bar's pixel position) goes stale. The user-
      // visible symptom: the bar drifts away from the cursor by
      // exactly the scroll delta until the cursor crosses a column
      // boundary or moves enough to re-fire mousemove.
      const cursor = lastCursorRef.current;
      if (!cursor) return;
      applyState(computeIndicatorState(cursor.x, cursor.y));
    }
    document.addEventListener("mousemove", onMove);
    // capture: true catches scroll events from any nested scroll
    // container — schedule-x's time grid has its own internal
    // overflow-y scroller, and we want the indicator to track that
    // too without us having to know which exact element scrolls.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [active]);

  // Render-time gate (rather than clearing state in the effect) — the
  // React Compiler `react-hooks/set-state-in-effect` rule disallows
  // calling `setState` in an effect body, and the visual outcome is
  // the same: nothing renders while inactive. Stale state from a
  // prior active period stays in memory but is overwritten on the
  // next mousemove the next time we're active.
  if (!active || !state) return null;

  return (
    <div
      style={{
        position: "fixed",
        // Center a 2-px line on the snap boundary. Coords come
        // straight from `state` — they were resolved against the
        // column rect at the time the state was built, so no second
        // layout read is needed (and can't drift from the cursor).
        top: state.top - 1,
        left: state.left,
        width: state.width,
        height: 2,
        zIndex: 30,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {/* Bar — same visual weight as schedule-x's current-time line so
          the two indicators read as part of the same family, but
          softer (lower opacity) since this one is just a hint. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "color-mix(in srgb, var(--color-primary) 55%, transparent)",
        }}
      />
      {/* Pill — round, primary-colored, jutting slightly past the
          column's leading edge. The `-9 px` left positions it so the
          column gridline cuts the pill in half (matches the
          current-time indicator's affordance). */}
      <div
        className="absolute flex items-center justify-center rounded-full shadow-sm"
        style={{
          left: -9,
          top: -8,
          width: 18,
          height: 18,
          background: "var(--color-primary)",
          color: "var(--color-primary-foreground)",
        }}
      >
        <Plus className="h-3 w-3" strokeWidth={2.5} />
      </div>
    </div>
  );
}
