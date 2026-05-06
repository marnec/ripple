import React, { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
import {
  createCalendar,
  createViewMonthGrid,
  createViewWeek,
  type CalendarType,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createScrollControllerPlugin } from "@schedule-x/scroll-controller";
import { ScheduleXCalendar } from "@schedule-x/react";
import { Temporal } from "temporal-polyfill";
import { useQuery } from "convex-helpers/react/cache";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
import { Plus, CalendarDays, CalendarCheck, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryParams } from "@ripple/shared/types/routes";
import "../Project/project-calendar.css";

// TaskDetailSheet stays lazy — it pulls in BlockNote + Yjs + y-partyserver
// (~hundreds of KB). Calling `prefetchTaskDetailSheet()` from a mount
// effect warms the module cache so the click→open animation isn't gated
// on a network round-trip.
const taskDetailSheetImporter = () =>
  import("../Project/TaskDetailSheet").then((m) => ({
    default: m.TaskDetailSheet,
  }));
const LazyTaskDetailSheet = React.lazy(taskDetailSheetImporter);

// Event detail sheet and create dialog are small (Sheet/Form/Command — all
// already in the page's bundle through other surfaces). Static imports
// keep the open animation snappy without bloating the chunk meaningfully.
import { EventDetailSheet } from "../Calendar/EventDetailSheet";
import { CreateEventDialog } from "../Calendar/CreateEventDialog";

// ────────────────────────────────────────────────────────────────────────
// Calendar styling — two visual lanes: "tasks" (existing palette, blue) and
// "events" (calls, indigo). Schedule-x uses calendarId to look these up.
// ────────────────────────────────────────────────────────────────────────

const CAL_TASK = "task";
const CAL_EVENT = "event";

const CALENDARS_CONFIG: Record<string, CalendarType> = {
  [CAL_TASK]: {
    colorName: "task",
    lightColors: { main: "#3b82f6", container: "#3b82f635", onContainer: "#0f172a" },
    darkColors: { main: "#60a5fa", container: "#60a5fa35", onContainer: "#f9fafb" },
  },
  [CAL_EVENT]: {
    colorName: "event",
    lightColors: { main: "#6366f1", container: "#6366f135", onContainer: "#0f172a" },
    darkColors: { main: "#818cf8", container: "#818cf835", onContainer: "#f9fafb" },
  },
};

// ────────────────────────────────────────────────────────────────────────
// Custom header — prev/next + Today + range label + Week/Month switcher.
// Mirrors ProjectCalendar's headerContent slot pattern but trimmed to the
// controls a personal calendar actually needs (no commitment toggle, no
// unscheduled sidebar). The schedule-x headerContent slot renders without
// props, so we feed it via context owned by `MyCalendarTabContent`.
// ────────────────────────────────────────────────────────────────────────

type CalendarHeaderValue = {
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  /** Bumped on every range update so the header re-reads the current date / view. */
  rangeVersion: number;
};

const CalendarHeaderContext = createContext<CalendarHeaderValue | null>(null);

function CalendarHeader() {
  const ctx = useContext(CalendarHeaderContext);
  if (!ctx) return null;
  const { calendarControls, rangeVersion: _rangeVersion } = ctx; // _rangeVersion: read to subscribe to nav changes

  let view: string = "week";
  let date: Temporal.PlainDate | null = null;
  try {
    view = calendarControls.getView();
    date = calendarControls.getDate();
  } catch {
    // calendar not initialised yet — fall through with safe defaults
  }

  const label = (() => {
    if (!date) return "";
    if (view === "month-grid") {
      return date.toLocaleString("en-US", { month: "long", year: "numeric" });
    }
    // Week view: render the Mon–Sun span containing `date`.
    const dow = date.dayOfWeek; // 1 (Mon) … 7 (Sun)
    const weekStart = date.subtract({ days: dow - 1 });
    const weekEnd = weekStart.add({ days: 6 });
    const sameMonth = weekStart.month === weekEnd.month;
    const sameYear = weekStart.year === weekEnd.year;
    const startFmt = weekStart.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    const endFmt = weekEnd.toLocaleString("en-US", {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startFmt} – ${endFmt}`;
  })();

  const stepBack = () => {
    if (!date) return;
    calendarControls.setDate(
      view === "month-grid" ? date.subtract({ months: 1 }) : date.subtract({ weeks: 1 }),
    );
  };
  const stepForward = () => {
    if (!date) return;
    calendarControls.setDate(
      view === "month-grid" ? date.add({ months: 1 }) : date.add({ weeks: 1 }),
    );
  };

  return (
    <div className="flex items-center justify-between w-full gap-2 px-1">
      {/* Left: nav + range label + Today */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepBack} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepForward} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium tabular-nums min-w-40">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => calendarControls.setDate(Temporal.Now.plainDateISO())}
          aria-label="Today"
        >
          <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Today</span>
        </Button>
      </div>

      {/* Right: Week / Month switcher */}
      <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
        <button
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
            view === "week"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => calendarControls.setView("week")}
          aria-label="Week view"
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Week</span>
        </button>
        <button
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
            view === "month-grid"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => calendarControls.setView("month-grid")}
          aria-label="Month view"
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Month</span>
        </button>
      </div>
    </div>
  );
}

// Stable reference — schedule-x's CalendarRenderer treats `customComponents`
// as a useEffect dep and replays the slide-in animation when its identity
// changes. Hoist out of render to keep the calendar quiet.
const CALENDAR_CUSTOM_COMPONENTS = {
  headerContent: CalendarHeader,
};

// ────────────────────────────────────────────────────────────────────────
// Tab component
// ────────────────────────────────────────────────────────────────────────

export function MyCalendarTab() {
  const { workspaceId } = useParams<QueryParams>();
  if (!workspaceId) return <SomethingWentWrong />;
  return <MyCalendarTabContent workspaceId={workspaceId} />;
}

function MyCalendarTabContent({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isMobile = useIsMobile();

  // Show all my events for the current calendar window. We use a generous
  // 90-day window (45 before / 45 after today) so view nav is snappy without
  // wiring schedule-x's per-range refetch — calendar event volume is tiny
  // (dozens per workspace, not thousands), so over-fetching is cheap.
  // Lazy useState so the clock is read exactly once on mount; the window
  // doesn't need to roll forward while the tab is open.
  const [{ rangeStartMs, rangeEndMs }] = useState(() => {
    const now = Date.now();
    return {
      rangeStartMs: now - 45 * 24 * 60 * 60 * 1000,
      rangeEndMs: now + 45 * 24 * 60 * 60 * 1000,
    };
  });

  const events = useQuery(api.calendarEvents.listMineInRange, {
    workspaceId,
    rangeStartMs,
    rangeEndMs,
  });
  // listByAssignee is the same query MyTasks uses — Convex deduplicates the
  // subscription, so we don't pay double even when both tabs are mounted.
  const tasks = useQuery(api.tasks.listByAssignee, {
    workspaceId,
    completed: false,
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<Id<"projects"> | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<Id<"calendarEvents"> | null>(null);

  // Sticky "has been opened at least once" flags. Sheets/dialogs need to
  // stay mounted while their `open` prop transitions back to false so the
  // exit animation can play; unmounting on close cuts the animation off.
  // Using a sticky flag instead of always-mounting preserves the lazy-chunk
  // benefit for users who never open the dialog/sheet. Set during render
  // (not in an effect) per project convention — see ActiveCallContext for
  // the same ratcheting pattern.
  const [taskSheetMounted, setTaskSheetMounted] = useState(false);
  const [eventSheetMounted, setEventSheetMounted] = useState(false);
  const [createMounted, setCreateMounted] = useState(false);
  if (selectedTaskId && !taskSheetMounted) setTaskSheetMounted(true);
  if (selectedEventId && !eventSheetMounted) setEventSheetMounted(true);
  if (openCreate && !createMounted) setCreateMounted(true);

  // Warm the heavy TaskDetailSheet chunk after the calendar has rendered
  // so the first click on a task event opens with a smooth animation
  // instead of waiting on a network fetch. Vite/React.lazy share their
  // import cache, so this resolves React.lazy's loader instantly. The
  // import returns a promise; we deliberately ignore it (and any error —
  // a real click will still surface load failures via the Suspense
  // fallback).
  useEffect(() => {
    void taskDetailSheetImporter();
  }, []);

  // Build schedule-x events list. Schedule-x 4.5's
  // `CalendarEventExternal.start/end` is typed as
  // `Temporal.ZonedDateTime | Temporal.PlainDate` — `PlainDate` for all-day
  // tasks, `ZonedDateTime` for timed calls. PlainDateTime is NOT accepted;
  // schedule-x calls `.withTimeZone()` on timed events when the week view
  // sorts them, which only ZonedDateTime exposes.
  const calendarEvents = useMemo(() => {
    const out: Array<{
      id: string;
      title: string;
      start: Temporal.PlainDate | Temporal.ZonedDateTime;
      end: Temporal.PlainDate | Temporal.ZonedDateTime;
      calendarId: string;
      _kind: "task" | "event";
      _taskProjectId?: Id<"projects">;
    }> = [];
    if (tasks) {
      for (const t of tasks) {
        const startDate = t.plannedStartDate ?? t.dueDate;
        if (!startDate) continue;
        const endDate = t.dueDate ?? startDate;
        out.push({
          id: `task-${t._id}`,
          title: t.title,
          start: Temporal.PlainDate.from(startDate),
          end: Temporal.PlainDate.from(endDate),
          calendarId: CAL_TASK,
          _kind: "task",
          _taskProjectId: t.projectId,
        });
      }
    }
    if (events) {
      for (const e of events) {
        out.push({
          id: `event-${e._id}`,
          title: e.title,
          start: msToZonedDateTime(e.startsAt),
          end: msToZonedDateTime(e.endsAt),
          calendarId: CAL_EVENT,
          _kind: "event",
        });
      }
    }
    return out;
  }, [events, tasks]);

  // Calendar-controls plugin — exposes getDate/setDate + getView/setView so
  // our custom header can drive nav. `rangeVersion` is bumped on every range
  // change so `<CalendarHeader />` re-reads the current label.
  const [calendarControls] = useState(() => createCalendarControlsPlugin());
  const [rangeVersion, setRangeVersion] = useState(0);

  // Current-time indicator: red horizontal line on today's column in the week
  // view. `fullWeekWidth: false` keeps the line scoped to today (cleaner than
  // a banner across the entire grid).
  // Scroll controller: scroll the week view to ~1 hour before "now" on mount
  // so users land on actionable time-of-day instead of midnight. Lazy
  // useState computes the initial scroll once per mount; we don't need to
  // re-pin the scroll position when the user navigates.
  const [currentTimePlugin] = useState(() =>
    createCurrentTimePlugin({ fullWeekWidth: false }),
  );
  const [scrollController] = useState(() => {
    const now = new Date();
    const target = new Date(now.getTime() - 60 * 60 * 1000); // 1h earlier
    const hh = String(target.getHours()).padStart(2, "0");
    const mm = String(target.getMinutes()).padStart(2, "0");
    return createScrollControllerPlugin({ initialScroll: `${hh}:${mm}` });
  });

  // Stable calendar instance — schedule-x docs warn that recreating the app
  // on every render flushes its state.
  const [calendarApp] = useState(() =>
    createCalendar({
      views: [createViewWeek(), createViewMonthGrid()],
      defaultView: "week",
      events: calendarEvents,
      calendars: CALENDARS_CONFIG,
      isDark,
      theme: "shadcn",
      plugins: [calendarControls, currentTimePlugin, scrollController],
      callbacks: {
        onEventClick: (ev) => {
          const id = String(ev.id);
          if (id.startsWith("task-")) {
            const taskId = id.slice(5) as Id<"tasks">;
            const match = tasks?.find((t) => t._id === taskId);
            setSelectedTaskId(taskId);
            setSelectedTaskProjectId(match?.projectId ?? null);
          } else if (id.startsWith("event-")) {
            setSelectedEventId(id.slice(6) as Id<"calendarEvents">);
          }
        },
        onRangeUpdate() {
          setRangeVersion((v) => v + 1);
        },
      },
    }),
  );

  // Diff incoming events into the existing calendar instance — schedule-x's
  // public events API is per-event (add/update/remove), so we maintain the
  // delta ourselves. The dependency-key keeps the loop O(n) on real change.
  // Temporal values stringify to a stable ISO form, so toString() works as
  // an equality key.
  const eventsKeyRef = React.useRef("");
  React.useEffect(() => {
    const key = calendarEvents
      .map((e) => `${e.id}|${e.start.toString()}|${e.end.toString()}|${e.title}|${e.calendarId}`)
      .join(",");
    if (key === eventsKeyRef.current) return;
    eventsKeyRef.current = key;

    const existing = calendarApp.events.getAll();
    const existingIds = new Set(existing.map((e) => String(e.id)));
    const incomingIds = new Set(calendarEvents.map((e) => e.id));
    for (const id of existingIds) {
      if (!incomingIds.has(id)) calendarApp.events.remove(id);
    }
    for (const e of calendarEvents) {
      if (!existingIds.has(e.id)) {
        calendarApp.events.add(e);
      } else {
        const prev = existing.find((x) => String(x.id) === e.id);
        if (
          prev &&
          (String(prev.start) !== e.start.toString() ||
            String(prev.end) !== e.end.toString() ||
            prev.title !== e.title ||
            prev.calendarId !== e.calendarId)
        ) {
          calendarApp.events.update(e);
        }
      }
    }
  }, [calendarApp, calendarEvents]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      {/* Toolbar — only the "New event" CTA for now; the calendar itself
          owns view switching. */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {tasks && events
            ? `${events.length} scheduled call${events.length === 1 ? "" : "s"}`
            : null}
        </div>
        <Button size="sm" onClick={() => setOpenCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New event
        </Button>
      </div>

      {/* Calendar grid — fills remaining height. The header context feeds
          our custom `headerContent` slot (prev/next, label, view switch). */}
      <CalendarHeaderContext.Provider value={{ calendarControls, rangeVersion }}>
        <div className="flex-1 min-h-0 relative">
          <ScheduleXCalendar
            calendarApp={calendarApp}
            customComponents={CALENDAR_CUSTOM_COMPONENTS}
          />
          {events?.length === 0 && tasks?.length === 0 && !isMobile && (
            <EmptyOverlay onCreate={() => setOpenCreate(true)} />
          )}
        </div>
      </CalendarHeaderContext.Provider>

      {/* Detail sheets + create dialog. The `*Mounted` flags ratchet
          false → true on first open and stay true so Radix's exit
          animation gets to play on close. `open` drives visibility. */}
      {eventSheetMounted && (
        <EventDetailSheet
          eventId={selectedEventId}
          open={!!selectedEventId}
          onOpenChange={(open) => {
            if (!open) setSelectedEventId(null);
          }}
          workspaceId={workspaceId}
        />
      )}
      {createMounted && (
        <CreateEventDialog
          workspaceId={workspaceId}
          open={openCreate}
          onOpenChange={setOpenCreate}
        />
      )}
      {/* TaskDetailSheet stays lazy (BlockNote + Yjs are heavy); the chunk
          is prefetched on mount above so the open animation is smooth. */}
      <Suspense fallback={null}>
        {taskSheetMounted && (
          <LazyTaskDetailSheet
            taskId={selectedTaskId}
            open={!!selectedTaskId}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedTaskId(null);
                setSelectedTaskProjectId(null);
              }
            }}
            workspaceId={workspaceId}
            projectId={
              selectedTaskProjectId ?? ("" as Id<"projects">)
            }
          />
        )}
      </Suspense>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Convert a UTC ms timestamp into a `Temporal.ZonedDateTime` in the user's
 *  local timezone. Schedule-x's `CalendarEventExternal` typing requires
 *  ZonedDateTime for timed events; PlainDateTime crashes the week view
 *  with `_start.withTimeZone is not a function`. */
function msToZonedDateTime(ms: number): Temporal.ZonedDateTime {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz);
}

function EmptyOverlay({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-2 text-center bg-background/80 backdrop-blur-sm rounded-lg px-6 py-4 pointer-events-auto">
        <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Nothing scheduled</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Plan a call or schedule a task to see it here.
        </p>
        <Button size="sm" variant="outline" onClick={onCreate} className="mt-1">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New event
        </Button>
      </div>
    </div>
  );
}
