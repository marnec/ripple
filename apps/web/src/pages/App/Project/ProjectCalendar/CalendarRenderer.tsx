import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  createCalendar,
  createViewMonthGrid,
  type BackgroundEvent,
  type CalendarApp,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { ScheduleXCalendar } from "@schedule-x/react";
import { useCalendarSync } from "../useCalendarSync";
import type { TaskCalendarEvent } from "./calendar-events";
import { CALENDARS_CONFIG } from "./calendar-events";
import { CalendarInternalContext } from "./calendar-contexts";
import {
  CustomEventContent,
  CalendarHeaderContent,
} from "./CalendarEventContent";

// Stable reference — must not be defined inline in the JSX below.
// ScheduleXCalendar's useEffect has `customComponents` as a dependency and calls
// calendarApp.render() on change, which replays the slide-in animation on every
// CalendarRenderer re-render.
const CALENDAR_CUSTOM_COMPONENTS = {
  dateGridEvent: CustomEventContent,
  monthGridEvent: CustomEventContent,
  headerContent: CalendarHeaderContent,
};

const BG_EVENT_SELECTOR = [
  ".sx__date-grid-background-event",
  ".sx__month-grid-background-event",
  ".sx__time-grid-background-event",
].join(", ");

export function CalendarRenderer({
  taskEvents,
  bgEvents,
  defaultView,
  isDark,
  onEventClick,
  onClickDate,
  onClickCycle,
  wrapperRef,
}: {
  taskEvents: TaskCalendarEvent[];
  bgEvents: BackgroundEvent[];
  defaultView: string;
  isDark: boolean;
  onEventClick: (id: string | number) => void;
  onClickDate?: (date: string) => void;
  onClickCycle?: (name: string) => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Stable ref so the event listener never needs to be re-registered.
  const onClickCycleRef = useRef(onClickCycle);
  useEffect(() => { onClickCycleRef.current = onClickCycle; });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    function handleClick(e: MouseEvent) {
      const bgEl = (e.target as HTMLElement).closest(BG_EVENT_SELECTOR);
      if (!bgEl) return;
      e.stopPropagation();
      onClickCycleRef.current?.(bgEl.getAttribute("title") ?? "");
    }
    wrapper.addEventListener("click", handleClick, true);
    return () => wrapper.removeEventListener("click", handleClick, true);
  }, [wrapperRef]);
  const [rangeVersion, setRangeVersion] = useState(0);

  const [calendarControls] = useState(() => createCalendarControlsPlugin());

  const [calendarApp] = useState<CalendarApp>(() =>
    createCalendar({
      views: [createViewMonthGrid()],
      defaultView,
      events: taskEvents,
      backgroundEvents: bgEvents,
      calendars: CALENDARS_CONFIG,
      isDark,
      theme: "shadcn",
      plugins: [calendarControls],
      callbacks: {
        onEventClick(event) {
          onEventClick(event.id);
        },
        onClickDate(date: string) {
          onClickDate?.(date);
        },
        onRangeUpdate() {
          setRangeVersion((v) => v + 1);
        },
      },
    }),
  );

  // Fade the view container on range change (anti-FOUC).
  useEffect(() => {
    if (rangeVersion === 0) return;
    const vc = wrapperRef.current?.querySelector<HTMLElement>(".sx__view-container");
    if (!vc) return;
    vc.style.opacity = "0";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        vc.style.opacity = "";
      });
    });
  }, [rangeVersion, wrapperRef]);

  useCalendarSync(calendarApp, taskEvents, bgEvents);

  return (
    <CalendarInternalContext.Provider value={{ calendarControls, rangeVersion }}>
      <div style={{ height: "100%" }} ref={wrapperRef}>
        <ScheduleXCalendar
          calendarApp={calendarApp}
          customComponents={CALENDAR_CUSTOM_COMPONENTS}
        />
      </div>
    </CalendarInternalContext.Provider>
  );
}
CalendarRenderer.whyDidYouRender = true;
