import { useContext, useEffect, useRef, useState } from "react";
import type { CalendarEventExternal } from "@schedule-x/calendar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuTrigger,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
} from "@/components/ui/responsive-dropdown-menu";
import { calendarDragContext } from "../calendarDragContext";
import { CalendarTaskMenuContext } from "./calendar-contexts";
import {
  type EventMeta,
  type TaskCalendarEvent,
  fmtHours,
  formatWorkPeriodTooltip,
} from "./calendar-events";

// ─────────────────────────────────────────────────────────────────────────────
// Actual work-period event content — hover highlight + tooltip
// ─────────────────────────────────────────────────────────────────────────────

// Module-level tracker so all segments of the same multi-row event can share
// hover state without going through React context or schedule-x event updates.
const actualHoverSubs = new Map<string, Set<(h: boolean) => void>>();
function subscribeActualHover(id: string, cb: (h: boolean) => void) {
  if (!actualHoverSubs.has(id)) actualHoverSubs.set(id, new Set());
  actualHoverSubs.get(id)!.add(cb);
  return () => actualHoverSubs.get(id)?.delete(cb);
}
function notifyActualHover(id: string, hovered: boolean) {
  actualHoverSubs.get(id)?.forEach((cb) => cb(hovered));
}

function ActualEventContent({
  meta,
  title,
  eventId,
}: {
  meta: EventMeta;
  title: string;
  eventId: string;
}) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => subscribeActualHover(eventId, setHovered) as () => void, [eventId]);

  const inner = (
    <div
      className="sx-event-content"
      style={{
        backgroundColor: "transparent",
        border: `1.5px dashed ${meta.statusColor}`,
        borderInlineStart: undefined,
        opacity: hovered ? 1 : 0.55,
        transition: "opacity 0.12s",
        cursor: "default",
      }}
      onMouseEnter={() => notifyActualHover(eventId, true)}
      onMouseLeave={() => notifyActualHover(eventId, false)}
    >
      <span className="sx-event-dot" style={{ backgroundColor: meta.statusColor }} />
      <span className="sx-event-title">{title}</span>
    </div>
  );

  if (meta.startMs == null || meta.endMs == null) return inner;

  return (
    <Tooltip>
      <TooltipTrigger render={inner} />
      <TooltipContent side="top">
        {formatWorkPeriodTooltip(meta.startMs, meta.endMs)}
      </TooltipContent>
    </Tooltip>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom event content — status dot + title (draggable for rescheduling)
// ─────────────────────────────────────────────────────────────────────────────

export function CustomEventContent({ calendarEvent }: { calendarEvent: CalendarEventExternal }) {
  const event = calendarEvent as TaskCalendarEvent;
  const meta: EventMeta = event._meta;
  const calendarId = calendarEvent.calendarId as string;
  const callbacks = useContext(CalendarTaskMenuContext);
  const isMobile = useIsMobile();

  // Controlled open — desktop only opens on mouseup after no drag.
  const [menuOpen, setMenuOpen] = useState(false);
  const didDragRef = useRef(false);

  // Actual work-period events: hover highlight + tooltip.
  if (meta.isActual) {
    return <ActualEventContent meta={meta} title={calendarEvent.title ?? ""} eventId={String(calendarEvent.id)} />;
  }

  const eventInner = (
    <div
      className="sx-event-content cursor-grab active:cursor-grabbing"
      style={{
        backgroundColor: meta.hasEstimate ? `var(--sx-color-${calendarId}-container)` : undefined,
        borderInlineStart: `4px solid var(--sx-color-${calendarId})`,
      }}
      data-no-estimate={meta.hasEstimate ? undefined : "true"}
      draggable
      onMouseDown={() => { didDragRef.current = false; }}
      onMouseUp={() => { if (!isMobile && !didDragRef.current) setMenuOpen(true); }}
      onDragStart={(e) => {
        didDragRef.current = true;
        e.dataTransfer.setData("task-id", String(calendarEvent.id));
        e.dataTransfer.effectAllowed = "move";
        calendarDragContext.setDragTask(String(calendarEvent.id));
        const blank = document.createElement("div");
        blank.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
        document.body.appendChild(blank);
        e.dataTransfer.setDragImage(blank, 0, 0);
        requestAnimationFrame(() => blank.remove());
      }}
      onDragEnd={() => calendarDragContext.clearDragTask()}
    >
      {meta.statusColor && (
        <span className="sx-event-dot" style={{ backgroundColor: meta.statusColor }} />
      )}
      <span className="sx-event-title">{calendarEvent.title}</span>
      {meta.actualHours !== undefined && (
        <span className="sx-event-actual ml-auto shrink-0 tabular-nums opacity-60 text-[10px]">
          {fmtHours(meta.actualHours)}
          {meta.plannedHours !== undefined ? ` / ${fmtHours(meta.plannedHours)}` : " actual"}
        </span>
      )}
    </div>
  );

  if (!callbacks) return eventInner;

  return (
    <ResponsiveDropdownMenu
      open={menuOpen}
      onOpenChange={(v) => {
        // Mobile: allow normal trigger-based opens (no drag conflict).
        // Desktop: only close here; opening is exclusively via onMouseUp above.
        if (isMobile) { setMenuOpen(v); return; }
        if (!v) setMenuOpen(false);
      }}
    >
      <ResponsiveDropdownMenuTrigger nativeButton={false} render={eventInner} />
      <ResponsiveDropdownMenuContent className="w-auto">
        <ResponsiveDropdownMenuItem onSelect={() => callbacks.onNavigate(meta.taskId)}>
          View task details
        </ResponsiveDropdownMenuItem>
        <ResponsiveDropdownMenuItem onSelect={() => callbacks.onUnschedule(meta.taskId)}>
          Unschedule
        </ResponsiveDropdownMenuItem>
      </ResponsiveDropdownMenuContent>
    </ResponsiveDropdownMenu>
  );
}

// The calendar toolbar moved out of schedule-x into the shared ScheduleHeader
// (see ScheduleHeader.tsx) so it can sit above both the Calendar and Gantt
// views.
