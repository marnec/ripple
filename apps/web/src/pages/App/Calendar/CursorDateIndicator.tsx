import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

type IndicatorState = {
  /** schedule-x month-grid day cell the cursor is over. */
  cell: HTMLElement;
  /** Resolved viewport rect of the cell at the moment this state was
   *  built — stored explicitly (rather than re-read in render) for the
   *  same reason `CursorTimeIndicator` snapshots its column rect: a
   *  scroll fired between state-build and render would otherwise drift
   *  the overlay by exactly the scroll delta. */
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Map a viewport mouse position to the month-grid day cell underneath,
 *  or `null` when the cursor isn't over an empty cell. We hide the cue
 *  over events (clicking those opens the detail sheet — a "+ create"
 *  affordance there is misleading, same contract as
 *  `CursorTimeIndicator`).
 *
 *  The week view's all-day strip and day-axis also tag their cells with
 *  `data-date`, so we additionally require an ancestor with the
 *  `sx__month-grid-day` class — that's the schedule-x marker for a real
 *  month grid cell. Without this guard the cue would appear in week
 *  view too. */
function computeIndicatorState(
  clientX: number,
  clientY: number,
): IndicatorState | null {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  // Existing event under cursor — let the event own the click.
  if (target.closest("[data-event-id]")) return null;
  if (target.closest(".sx__month-grid-event")) return null;
  if (target.closest(".sx__month-grid-background-event")) return null;
  // "+ N more" overflow affordance — leave the button visible without
  // our overlay covering it.
  if (target.closest(".sx__month-grid-day__events-more")) return null;
  const cell = target.closest<HTMLElement>(".sx__month-grid-day");
  if (!cell) return null;
  // Make sure this is our calendar instance — there can be multiple
  // schedule-x calendars mounted on the same page (e.g. project +
  // dashboard) and we don't want the indicator bleeding across.
  if (!cell.closest(".sx-react-calendar-wrapper")) return null;
  const rect = cell.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    cell,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export type CursorDateIndicatorProps = {
  /** Whether the indicator should be tracking. Pass `false` while a
   *  create dialog is open or while the view isn't month-grid; in
   *  those states the cue is either redundant or wrong. Toggling off
   *  detaches the document mousemove listener entirely (no per-frame
   *  work while inactive). */
  active: boolean;
};

/**
 * "Click here to create" hover cue for the calendar's month grid.
 * Mirrors `CursorTimeIndicator`'s visual language — primary-tinted
 * tint with a `+` pill — but adapted to the discrete-cell month
 * layout: the entire day cell gets a subtle outline + tint, with a
 * `+` pill anchored to the bottom-right corner so it doesn't fight
 * the date number that schedule-x renders top-left.
 *
 * Position is fixed-positioned over the calendar via the cell's
 * viewport rect, so it survives schedule-x's internal layout
 * (week-spanning event rows, `+N more` overflow row) without us
 * having to splice into its DOM.
 */
export function CursorDateIndicator({ active }: CursorDateIndicatorProps) {
  const [state, setState] = useState<IndicatorState | null>(null);
  // Cached last-seen cursor coords — the scroll handler reads these
  // to recompute the cell rect when the page or the calendar's own
  // overflow scroller moves under a stationary cursor. Same trick
  // `CursorTimeIndicator` uses; without it the overlay would freeze
  // at its pre-scroll viewport coords.
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    // Bail-out-friendly setter so a smooth-moving cursor only
    // re-renders when something visually observable changed (the cell
    // identity, or its viewport rect after a scroll/resize).
    function applyState(next: IndicatorState | null) {
      setState((prev) => {
        if (!next && !prev) return prev;
        if (!next || !prev) return next;
        if (
          prev.cell === next.cell &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height
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
      const cursor = lastCursorRef.current;
      if (!cursor) return;
      applyState(computeIndicatorState(cursor.x, cursor.y));
    }
    document.addEventListener("mousemove", onMove);
    // capture: true catches scroll from any nested overflow container
    // (schedule-x's `.sx__view-container` is its own scroller).
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
  // the same: nothing renders while inactive.
  if (!active || !state) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: state.top,
        left: state.left,
        width: state.width,
        height: state.height,
        // Above the cell background, below the create dialog (which
        // sits on Radix's portal layer, ≥50). Matches the time-grid
        // hint's z-index family.
        zIndex: 30,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {/* Cell tint + outline — same primary-color family as the time-
          grid bar, but softer: a fill (not just a line) since this
          surface is 2D. 8% fill + 35% border reads as "this cell is
          targetable" without competing with the events inside it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "color-mix(in srgb, var(--color-primary) 8%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)",
        }}
      />
      {/* `+` pill — bottom-right so it doesn't collide with the date
          number schedule-x renders in the top-left of every cell.
          Same dimensions/colors as the time-grid pill so the two cues
          read as one family. */}
      <div
        className="absolute flex items-center justify-center rounded-full shadow-sm"
        style={{
          right: 6,
          bottom: 6,
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
