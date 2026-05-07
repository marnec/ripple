import { useEffect, useState } from "react";
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
};

/** Map a viewport mouse position to a snapped time-grid slot, or
 *  return `null` when the cursor isn't over an empty time-grid cell.
 *  We hide the hint over existing events because clicking one opens
 *  the detail sheet — the "+ create" affordance there is misleading. */
function computeIndicatorState(e: MouseEvent): IndicatorState | null {
  const target = document.elementFromPoint(e.clientX, e.clientY);
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
  const offsetY = e.clientY - colRect.top;
  const pxPerMin = colRect.height / DAY_MIN;
  const minutesRaw = offsetY / pxPerMin;
  // Round to the nearest 15-min boundary so the line jumps slot-by-slot
  // instead of pixel-by-pixel — that's the visual contract that makes
  // "where the line is" match "where the ghost will start".
  const offsetMin = Math.max(
    0,
    Math.min(DAY_MIN - SLOT_MIN, Math.round(minutesRaw / SLOT_MIN) * SLOT_MIN),
  );
  return { dayColumn: col, offsetMin };
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

  useEffect(() => {
    if (!active) return;
    function onMove(e: MouseEvent) {
      const next = computeIndicatorState(e);
      setState((prev) => {
        // Bail-out equality check so a smooth-moving cursor doesn't
        // re-render the indicator at every mousemove tick — only when
        // the snapped slot actually changes (≈ 4× per minute on a
        // 24h column at typical heights).
        if (!next && !prev) return prev;
        if (!next || !prev) return next;
        if (
          prev.dayColumn === next.dayColumn &&
          prev.offsetMin === next.offsetMin
        ) {
          return prev;
        }
        return next;
      });
    }
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
    };
  }, [active]);

  // Render-time gate (rather than clearing state in the effect) — the
  // React Compiler `react-hooks/set-state-in-effect` rule disallows
  // calling `setState` in an effect body, and the visual outcome is
  // the same: nothing renders while inactive. Stale state from a
  // prior active period stays in memory but is overwritten on the
  // next mousemove the next time we're active.
  if (!active || !state) return null;

  const colRect = state.dayColumn.getBoundingClientRect();
  if (colRect.height <= 0) return null;
  const pxPerMin = colRect.height / DAY_MIN;
  const top = colRect.top + state.offsetMin * pxPerMin;

  return (
    <div
      style={{
        position: "fixed",
        // Center a 2-px line on the snap boundary.
        top: top - 1,
        left: colRect.left,
        width: colRect.width,
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
