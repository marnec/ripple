import { useEffect, useRef } from "react";
import type { CalendarApp, BackgroundEvent } from "@schedule-x/calendar";
import type { TaskCalendarEvent } from "./ProjectCalendar";

function isTaskEvent(e: unknown): e is TaskCalendarEvent {
  return typeof e === "object" && e !== null && "_meta" in e && (e as any)._meta != null;
}

export function useCalendarSync(
  calendarApp: CalendarApp | null,
  taskEvents: TaskCalendarEvent[],
  bgEvents: BackgroundEvent[],
): void {
  const bgEventsKeyRef = useRef("");
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => {
    if (!calendarApp) return;
    const key = bgEvents.map((e) => `${String(e.start)}:${String(e.end)}`).join("|");
    if (key === bgEventsKeyRef.current) return;
    bgEventsKeyRef.current = key;
    // eslint-disable-next-line react-hooks/immutability
    (calendarApp as any).$app.calendarEvents.backgroundEvents.value = bgEvents;
  }, [bgEvents, calendarApp]);

  const eventsKeyRef = useRef("");
  useEffect(() => {
    if (!calendarApp) return;
    const key = taskEvents
      .map((e) =>
        `${e.id}|${String(e.start)}|${String(e.end)}|${e.title}|${e.calendarId ?? ""}|${e._meta.statusColor}|${e._meta.hasEstimate}`,
      )
      .join(",");
    if (key === eventsKeyRef.current) return;
    eventsKeyRef.current = key;

    const existing = calendarApp.events.getAll();
    const existingMap = new Map(existing.map((e) => [String(e.id), e]));
    const newMap = new Map(taskEvents.map((e) => [String(e.id), e]));

    for (const [id] of existingMap) {
      if (!newMap.has(id)) calendarApp.events.remove(id);
    }
    for (const [id, event] of newMap) {
      if (!existingMap.has(id)) {
        calendarApp.events.add(event as any);
      } else {
        const prev = existingMap.get(id)!;
        const prevMeta = isTaskEvent(prev) ? prev._meta : undefined;
        const newMeta = event._meta;
        if (
          String(prev.start) !== String(event.start) ||
          String(prev.end) !== String(event.end) ||
          prev.title !== event.title ||
          prev.calendarId !== event.calendarId ||
          prevMeta?.statusColor !== newMeta.statusColor ||
          prevMeta?.hasEstimate !== newMeta.hasEstimate
        ) {
          calendarApp.events.update(event as any);
        }
      }
    }
  }, [taskEvents, calendarApp]);
}
