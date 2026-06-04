import type React from "react";
import { useLayoutEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { estimateToDays, addCalendarDays } from "@/lib/calendar-utils";
import { type EnrichedTask, tailwindToHex } from "./calendar-events";

type GhostPos = { top: number; left: number; width: number; height: number };

function resolveGhostPosition({
  calendarRoot,
  date,
  spanDays,
}: {
  calendarRoot: Element | null;
  date: string;
  spanDays: number;
}): GhostPos | null {
  if (!calendarRoot) return null;
  const dayEl = calendarRoot.querySelector(`[data-date="${date}"]`);
  if (!dayEl) return null;
  const dayRect = dayEl.getBoundingClientRect();

  // Anchor vertically to the target day's own events container. It is always
  // rendered (even with no events), and its top already accounts for the day
  // header height — which is taller in the first week row because of the
  // day-name label (e.g. "SUN"). Measuring it per-cell is correct whether or
  // not anything is scheduled, unlike deriving an offset from some other cell's
  // event (which broke alignment when the grid had no events to sample).
  // If the cell already has events, anchor below the last one (plus the grid
  // gap) so the ghost previews the slot a drop would actually land in, rather
  // than overlapping the existing events.
  const eventsEl = dayEl.querySelector(".sx__month-grid-day__events");
  const GRID_GAP = 4; // matches .sx__month-grid-day__events { grid-gap: 4px }
  let top: number;
  if (eventsEl) {
    const cellEvents = eventsEl.querySelectorAll(".sx__month-grid-event");
    const lastEvent = cellEvents[cellEvents.length - 1];
    top = lastEvent
      ? lastEvent.getBoundingClientRect().bottom + GRID_GAP
      : eventsEl.getBoundingClientRect().top;
  } else {
    top = dayRect.top + 24;
  }

  // Match an existing event's height if one is on screen, else fall back.
  let eventHeight = 22;
  const refEvent = calendarRoot.querySelector(".sx__month-grid-event");
  if (refEvent) {
    eventHeight = Math.round(refEvent.getBoundingClientRect().height);
  }

  let width = dayRect.width - 4;
  if (spanDays > 1) {
    const endDate = addCalendarDays(date, spanDays - 1);
    const endEl = calendarRoot.querySelector(`[data-date="${endDate}"]`);
    if (endEl) {
      const endRect = endEl.getBoundingClientRect();
      if (Math.abs(endRect.top - dayRect.top) < 10) {
        width = endRect.right - dayRect.left - 4;
      }
    }
  }

  return { top, left: dayRect.left + 2, width, height: eventHeight };
}

export function CalendarGhostOverlay({
  task,
  hoveredDropDate,
  multiplier,
  calendarId,
  wrapperRef,
}: {
  task: EnrichedTask;
  hoveredDropDate: string;
  multiplier: 1 | 5;
  calendarId: string;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<GhostPos | null>(null);

  useLayoutEffect(() => {
    const spanDays = estimateToDays(task.estimate, multiplier);
    setPos(resolveGhostPosition({ calendarRoot: wrapperRef.current, date: hoveredDropDate, spanDays }));
  }, [wrapperRef, hoveredDropDate, task.estimate, multiplier]);

  const statusColor = task.status ? tailwindToHex(task.status.color) : "#6b7280";
  const hasEstimate = !!task.estimate;

  return (
    <AnimatePresence>
      {pos && (
        <motion.div
          key="ghost"
          style={{
            position: "fixed",
            height: pos.height,
            zIndex: 1000,
            overflow: "hidden",
            pointerEvents: "none",
            borderRadius: "3px",
          }}
          initial={{ opacity: 0, top: pos.top, left: pos.left, width: pos.width }}
          animate={{ opacity: 0.75, top: pos.top, left: pos.left, width: pos.width }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 0.5 }}
        >
          <div
            className="sx-event-content"
            style={{
              backgroundColor: hasEstimate ? `var(--sx-color-${calendarId}-container)` : undefined,
              borderInlineStart: `4px solid var(--sx-color-${calendarId})`,
              ...(hasEstimate ? {} : {
                borderTop: "1px dashed currentColor",
                borderRight: "1px dashed currentColor",
                borderBottom: "1px dashed currentColor",
                borderRadius: "3px",
                opacity: 0.75,
              }),
            }}
          >
            <span className="sx-event-dot" style={{ backgroundColor: statusColor }} />
            <span className="sx-event-title">{task.title}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
