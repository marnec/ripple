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

  let topOffset = 24;
  let eventHeight = 22;
  const refEvent = calendarRoot.querySelector(".sx__month-grid-event");
  const refCell = refEvent?.closest("[data-date]");
  if (refEvent && refCell) {
    const eventRect = refEvent.getBoundingClientRect();
    const cellRect = refCell.getBoundingClientRect();
    topOffset = Math.round(eventRect.top - cellRect.top);
    eventHeight = Math.round(eventRect.height);
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

  return { top: dayRect.top + topOffset, left: dayRect.left + 2, width, height: eventHeight };
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
