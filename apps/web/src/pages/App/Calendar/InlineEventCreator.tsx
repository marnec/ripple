import { useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
} from "@/components/ui/popover";

import type { Id } from "@convex/_generated/dataModel";
import { CreateEventForm } from "./CreateEventForm";

// ────────────────────────────────────────────────────────────────────────
// Ghost geometry helpers
// ────────────────────────────────────────────────────────────────────────

/** schedule-x's default day window — `00:00` → `24:00`. The package
 *  supports custom `dayBoundaries`, but our calendar doesn't set any so
 *  we hard-code the full-day range when mapping ms ↔ pixel offsets
 *  inside a day column. If that changes, this constant + the cursor →
 *  time helpers in `MyCalendarTab` must be updated together. */
const DAY_START_MIN = 0;
const DAY_END_MIN = 24 * 60;
const DAY_RANGE_MIN = DAY_END_MIN - DAY_START_MIN;

/** Resolve an absolute epoch ms timestamp into the local-time minute
 *  offset within its day. Used to pixel-map start/end onto a column. */
function minutesIntoLocalDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

type GhostRect = { top: number; left: number; width: number; height: number };

/** Compute the ghost's viewport rect from a day column + start/end ms.
 *  Returns `null` when the column has zero height (e.g. measured during
 *  a layout-thrashing transition); callers fall back to a hidden ghost
 *  in that frame. */
function computeGhostRect(
  dayColumn: HTMLElement,
  startMs: number,
  endMs: number,
): GhostRect | null {
  const colRect = dayColumn.getBoundingClientRect();
  if (colRect.height <= 0) return null;
  const pxPerMin = colRect.height / DAY_RANGE_MIN;
  const startMin = Math.max(
    DAY_START_MIN,
    Math.min(DAY_END_MIN - 1, minutesIntoLocalDay(startMs)),
  );
  // The end can spill into "tomorrow" (cross-midnight) — clamp the
  // visible end to the day's last pixel so the rect stays inside the
  // column. The form still records the true end via its own state, so
  // persistence is unaffected by visual clamping.
  const sameDay =
    new Date(startMs).toDateString() === new Date(endMs).toDateString();
  const rawEndMin = sameDay ? minutesIntoLocalDay(endMs) : DAY_END_MIN;
  const endMin = Math.max(startMin + 1, Math.min(DAY_END_MIN, rawEndMin));
  const top = colRect.top + (startMin - DAY_START_MIN) * pxPerMin;
  const height = Math.max(2, (endMin - startMin) * pxPerMin);
  // 1 px inside-edges keep the ghost clear of the column's hairline
  // gridlines.
  return {
    top,
    left: colRect.left + 1,
    width: Math.max(2, colRect.width - 2),
    height,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export type InlineEventCreatorPhase = "dragging" | "creating";

export type InlineEventCreatorProps = {
  workspaceId: Id<"workspaces">;
  /** schedule-x time-grid day column the ghost is anchored to. The
   *  popover anchors to the ghost div directly, but the column drives
   *  the pixel-position math (start/end offsets are local-time minutes
   *  mapped into the column's height). */
  dayColumn: HTMLElement;
  /** Effective start of the ghost in epoch ms. */
  startMs: number;
  /** Effective end of the ghost in epoch ms — must be > startMs. */
  endMs: number;
  /** "dragging" while the user is mid-drag — ghost only, no popover.
   *  "creating" once the drag has ended (or a click landed) — ghost
   *  stays visible and the popover with form opens beside it. */
  phase: InlineEventCreatorPhase;
  /** Called when the user dismisses the popover (cancel button,
   *  escape, click outside) or after a successful create. The parent
   *  should unmount this component on close.  No-op while `phase` is
   *  "dragging" — the parent owns the drag lifecycle. */
  onClose: () => void;
  /** Called whenever the form's start/end times change so the parent
   *  can update its `startMs`/`endMs` state and the ghost follows the
   *  user's edits live. Only fires in the "creating" phase. */
  onTimesChange?: (start: Date, end: Date) => void;
};

/**
 * Single component covering both the active drag and the create-form
 * editing phases of click/drag-to-create on the calendar's time grid.
 *
 * Phase = "dragging":
 *   - Renders only the ghost (a `position: fixed` translucent block
 *     over the day column).
 *   - Times come from props; the parent's mousemove handler drives
 *     them. We do nothing else — no popover, no form, no listeners.
 *
 * Phase = "creating":
 *   - Renders the ghost AND a Popover anchored to it.
 *   - The Popover contains a compact `<CreateEventForm />`. Submitting
 *     it persists the event; cancel/escape/outside-click dismisses.
 *   - The form mirrors live edits via `onTimesChange`, so the parent
 *     can echo them back through the `startMs`/`endMs` props and the
 *     ghost stays in sync with the form fields.
 *
 * Keeping a single instance across both phases means the ghost div
 * stays mounted across the drag → create transition (no flicker). The
 * Popover only mounts on the transition into "creating", so the form
 * is fresh — its lazy-init defaults read the startMs/endMs that were
 * current the moment the user released the mouse.
 *
 * Re-anchoring on layout: the ghost rect is recomputed whenever the
 * window resizes or anything inside it scrolls (capture-phase listener
 * catches schedule-x's internal time-grid scroller). base-ui's
 * floating-ui-backed positioner watches the same DOM, so the popover
 * follows the ghost without us having to re-bind the anchor.
 */
export function InlineEventCreator({
  workspaceId,
  dayColumn,
  startMs,
  endMs,
  phase,
  onClose,
  onTimesChange,
}: InlineEventCreatorProps) {
  // `geometryEpoch` is bumped on scroll/resize to force a re-render
  // that re-reads the column's bounding rect. Cheaper than a
  // ResizeObserver per ghost since the events are infrequent and the
  // rect read is O(1).
  const [geometryEpoch, setGeometryEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setGeometryEpoch((e) => e + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  // Compute the ghost rect on every render — `getBoundingClientRect`
  // during render is cheap and React-safe (no side effects observed
  // from the DOM perspective). `geometryEpoch` is read into the dep
  // array of the implicit memo so the React Compiler knows scroll
  // counts as a re-render trigger; we void-reference it to keep the
  // intent explicit in the closure.
  void geometryEpoch;
  const rect = computeGhostRect(dayColumn, startMs, endMs);

  const ghostRef = useRef<HTMLDivElement>(null);
  const isCreating = phase === "creating";

  return (
    <>
      {/* Ghost — position:fixed div sitting over the day column.
          pointer-events:none lets clicks/drags pass through to the
          underlying calendar so a NEW drag-create can start while the
          popover is open (it'll dismiss on outside-click, then
          mousedown lands on the calendar normally). */}
      {rect && (
        <div
          ref={ghostRef}
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            background:
              "color-mix(in srgb, var(--color-primary) 18%, transparent)",
            border: "1px solid var(--color-primary)",
            borderRadius: 4,
            zIndex: 40,
            pointerEvents: "none",
          }}
          aria-hidden
        />
      )}

      {/* Popover anchored to the ghost. Always mounted so base-ui's
          state machine sees a clean `open` transition false → true
          when the drag finishes — opening on first mount with
          `open={true}` skipped over base-ui's open animation entirely
          for us, and the popup never visibly appeared. The `Popover`
          wrapper is essentially free when closed (it just provides
          context); the heavy DOM (Portal + Positioner + Popup) only
          mounts when `open` becomes true.
          base-ui's `anchor` accepts a ref; floating-ui under the
          hood auto-updates on layout changes.
          `side="right"` is the default; collision handling auto-flips
          to "left" when the right side has no room (rightmost column
          on a packed week view, narrow viewports, etc.). */}
      <Popover
        open={isCreating}
        onOpenChange={(o) => {
          // Only treat false transitions as "user dismissed". The
          // popover never sets itself open — we control the `open`
          // prop — so any callback we receive with `o === true` is a
          // base-ui internal echo we should ignore. The `isCreating`
          // guard prevents an early-mount spurious `false` from
          // immediately tearing the creator down before the drag
          // even ends.
          if (!o && isCreating) onClose();
        }}
      >
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={-4}
          anchor={ghostRef}
          // 22rem (`w-88`) keeps the popup narrow enough that the
          // collision-flip-to-left fits beside the time-axis even
          // on a 1280-wide viewport.
          className="w-88 p-3"
          // The form's `<Input autoFocus>` on the title field
          // already handles initial focus. Telling base-ui not to
          // move focus itself avoids a brief focus jump to the
          // popup container (which would scroll the calendar).
          initialFocus={false}
        >
          <CreateEventForm
            workspaceId={workspaceId}
            initialDate={new Date(startMs)}
            initialEndDate={new Date(endMs)}
            density="compact"
            onSuccess={onClose}
            onCancel={onClose}
            onTimesChange={onTimesChange}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
