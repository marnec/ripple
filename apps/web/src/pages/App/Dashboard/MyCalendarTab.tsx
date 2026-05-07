import React, { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
import {
  createCalendar,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
  createViewWeekAgenda,
  type CalendarType,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createResizePlugin } from "@schedule-x/resize";
import { createScrollControllerPlugin } from "@schedule-x/scroll-controller";
import { ScheduleXCalendar } from "@schedule-x/react";
import { Temporal } from "temporal-polyfill";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, CalendarDays, CalendarCheck, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
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
import {
  NotifyInviteesDialog,
  type RescheduleChoice,
} from "../Calendar/NotifyInviteesDialog";

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

type DashboardCalendarView = "week" | "month-grid";

type CalendarHeaderValue = {
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  /** Bumped on every range update so the header re-reads the current date. */
  rangeVersion: number;
  /** React-owned view state — drives the highlight directly. Single
   *  source of truth, kept in sync with schedule-x via `setView`. */
  view: DashboardCalendarView;
  setView: (next: DashboardCalendarView) => void;
  /** `null` while the events query is loading — header hides the counter
   *  in that state to avoid a "0 scheduled" flash before data lands. */
  eventCount: number | null;
  onCreateEvent: () => void;
};

const CalendarHeaderContext = createContext<CalendarHeaderValue | null>(null);

function CalendarHeader() {
  const ctx = useContext(CalendarHeaderContext);
  if (!ctx) return null;
  const {
    calendarControls,
    rangeVersion: _rangeVersion, // read to subscribe to nav changes
    view,
    setView,
    eventCount,
    onCreateEvent,
  } = ctx;

  let date: Temporal.PlainDate | null = null;
  try {
    date = calendarControls.getDate();
  } catch {
    // calendar not initialised yet — fall through with safe defaults
  }

  // Two label variants — long (desktop) shows the full week range with day
  // numbers; compact (mobile) drops the day numbers because "May 4 – 10,
  // 2026" eats the whole header row alongside nav buttons + view switcher.
  // For the week-view compact form we use the month/year of the week's
  // centre day (Thursday) so a Mon–Sun week that crosses a month boundary
  // still gets a sensible single-month label rather than a misleading
  // start-month-only one.
  const labels = (() => {
    if (!date) return { full: "", compact: "" };
    if (view === "month-grid") {
      const full = date.toLocaleString("en-US", { month: "long", year: "numeric" });
      return { full, compact: full };
    }
    // Week view
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
    const full = `${startFmt} – ${endFmt}`;
    const centre = weekStart.add({ days: 3 });
    const compact = centre.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    return { full, compact };
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
    // No internal horizontal padding — `.sx__calendar-header` had its
    // 16px inline padding zeroed in project-calendar.css so the header
    // buttons sit flush with the toolbar's content edge.
    <div className="flex items-center justify-between w-full gap-2">
      {/* Left: nav + range label + Today */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepBack} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stepForward} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="hidden sm:inline text-sm font-medium tabular-nums min-w-40">
          {labels.full}
        </span>
        <span className="sm:hidden text-sm font-medium tabular-nums">
          {labels.compact}
        </span>
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

      {/* Right cluster: New event + view switcher.
          New event are desktop-only on mobile it'd
          crowd the calendar's own header out, so the parent renders
          a HeaderSlot fallback for "New event"
          (it's also implied by the visible event list). */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="hidden md:inline-flex h-7"
          onClick={onCreateEvent}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New event
        </Button>

        {/* Week / Month switcher */}
        <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              view === "week"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setView("week")}
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
            onClick={() => setView("month-grid")}
            aria-label="Month view"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Month</span>
          </button>
        </div>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryEventId = searchParams.get("event");

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
  // Seed `selectedEventId` from a `?event=<id>` deep link (notification
  // URLs use this query-param shape — see convex/calendarEvents.ts).
  // Lazy initializer reads searchParams ONCE on mount; the strip effect
  // below removes the param afterwards so a manual page refresh doesn't
  // re-open a sheet the user already dismissed.
  const [selectedEventId, setSelectedEventId] = useState<Id<"calendarEvents"> | null>(
    () => (queryEventId ? (queryEventId as Id<"calendarEvents">) : null),
  );

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

  // Strip the `?event=<id>` query param after we've consumed it (the
  // selectedEventId initializer above seeded from it on mount). Without
  // this, a manual refresh would re-open a sheet the user dismissed.
  // Mobile: the early-return Navigate below redirects away anyway, so
  // the strip is a no-op there but harmless.
  useEffect(() => {
    if (!queryEventId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("event");
    setSearchParams(next, { replace: true });
    // Run once on mount only — re-running after the strip would just
    // no-op (queryEventId would be empty), but the lint can't see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // View state lives in React, not schedule-x — `calendarControls.getView()`
  // can return stale values immediately after `setView` (the underlying
  // signal hasn't propagated). React state lets the highlight update
  // synchronously on click, and the wrapper below pushes the new view to
  // schedule-x to keep it rendered correctly.
  const [view, setView] = useState<DashboardCalendarView>("week");
  const switchView = (next: DashboardCalendarView) => {
    setView(next);
    try {
      calendarControls.setView(next);
    } catch {
      // calendar not yet rendered — schedule-x's setView throws before
      // first render. The defaultView in createCalendar already matches
      // our initial state, so this is harmless.
    }
  };

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

  // Drag-to-reschedule + resize plugins — only meaningful for `event-*`
  // ids (calendar events the viewer organises). Tasks dragged here
  // would need to write back to the task's plannedStartDate, which is
  // the project calendar's job; we block those drags via
  // `onBeforeEventUpdate` below.
  //
  // Version compat: schedule-x calendar core is on v4 but the OSS
  // drag/resize plugins ship at v3.7.x — no v4 plugins were ever
  // released. The two libraries dispatch through `$app.config.plugins`
  // by name. Method shapes/signatures match BUT v4 calls
  // `startTimeGridDrag` / `startDateGridDrag` / `startMonthGridDrag`
  // while v3 exposes `createTimeGridDragHandler` /
  // `createDateGridDragHandler` / `createMonthGridDragHandler`. The
  // resize plugin's `createTimeGridEventResizer` /
  // `createDateGridEventResizer` names already match. We patch the
  // missing aliases onto the drag plugin instance — the underlying
  // handler constructors are side-effect-only (they wire document
  // listeners in their `init()`), so the alias just forwards the call
  // and ignores the return value (v4 doesn't read it). When v4 plugins
  // eventually land, drop the shim.
  const [dragAndDropPlugin] = useState(() => {
    const base = createDragAndDropPlugin(15);
    type DragHandlerArgs = Parameters<typeof base.createTimeGridDragHandler>;
    type DateHandlerArgs = Parameters<typeof base.createDateGridDragHandler>;
    type MonthHandlerArgs = Parameters<typeof base.createMonthGridDragHandler>;
    const shim = base as typeof base & {
      startTimeGridDrag: (...args: DragHandlerArgs) => void;
      startDateGridDrag: (...args: DateHandlerArgs) => void;
      startMonthGridDrag: (...args: MonthHandlerArgs) => void;
    };
    shim.startTimeGridDrag = (...args) => {
      base.createTimeGridDragHandler(...args);
    };
    shim.startDateGridDrag = (...args) => {
      base.createDateGridDragHandler(...args);
    };
    shim.startMonthGridDrag = (...args) => {
      base.createMonthGridDragHandler(...args);
    };
    return shim;
  });
  const [resizePlugin] = useState(() => createResizePlugin(15));

  // Mutation handle + a ref-trampoline for the schedule-x callback —
  // the calendar instance is built once in `useState`'s lazy
  // initializer, so any callback we put on its config closes over the
  // FIRST render's closure. The ref is updated on every render so the
  // committed handler always reads the latest state (events, isMobile,
  // mutation reference, etc.).
  const updateEventMutation = useMutation(api.calendarEvents.update);
  type RescheduleAttempt = {
    eventId: Id<"calendarEvents">;
    /** Original schedule-x event we can restore on a revert. */
    original:
      | { id: string; start: Temporal.PlainDate | Temporal.ZonedDateTime;
          end: Temporal.PlainDate | Temporal.ZonedDateTime;
          title: string; calendarId: string };
    oldStartsAt: number;
    oldEndsAt: number;
    newStartsAt: number;
    newEndsAt: number;
    title: string;
    inviteeCount: number;
  };
  const [pendingReschedule, setPendingReschedule] = useState<RescheduleAttempt | null>(null);
  const onEventUpdateRef = React.useRef<(updated: { id: string | number; start: unknown; end: unknown }) => void>(() => {});
  React.useEffect(() => {
    onEventUpdateRef.current = (updated) => {
      const id = String(updated.id);
      if (!id.startsWith("event-")) return; // tasks blocked at onBeforeEventUpdate
      const eventId = id.slice(6) as Id<"calendarEvents">;
      const sourceEvent = events?.find((e) => e._id === eventId);
      if (!sourceEvent) return;

      // Schedule-x emits start/end as Temporal types; convert to ms.
      const newStartsAt = temporalToMs(updated.start);
      const newEndsAt = temporalToMs(updated.end);
      if (newStartsAt === sourceEvent.startsAt && newEndsAt === sourceEvent.endsAt) {
        return; // no-op (drag aborted or returned to original cell)
      }

      const inviteeCount = sourceEvent.nonOrganizerInviteeCount;
      // No external eyes on the event → just write through. The
      // organizer's own calendar updates reactively from convex.
      if (inviteeCount === 0) {
        void updateEventMutation({
          eventId,
          startsAt: newStartsAt,
          endsAt: newEndsAt,
          notifyInvitees: false,
        }).catch((err: unknown) => {
          toast.error("Could not reschedule", {
            description: getErrorMessage(err),
          });
        });
        return;
      }

      // Has guests → ask. The dialog owns the choice; we stage the
      // reschedule details + a snapshot of the original event so a
      // "Revert" action can roll the visual back without a refetch.
      setPendingReschedule({
        eventId,
        original: {
          id,
          start: msToZonedDateTime(sourceEvent.startsAt),
          end: msToZonedDateTime(sourceEvent.endsAt),
          title: sourceEvent.title,
          calendarId: CAL_EVENT,
        },
        oldStartsAt: sourceEvent.startsAt,
        oldEndsAt: sourceEvent.endsAt,
        newStartsAt,
        newEndsAt,
        title: sourceEvent.title,
        inviteeCount,
      });
    };
  });

  // Stable calendar instance — schedule-x docs warn that recreating the app
  // on every render flushes its state.
  const [calendarApp] = useState(() =>
    createCalendar({
      // Pair each wide-screen view with its small-screen agenda variant.
      // Schedule-x flags `Week` and `MonthGrid` as `hasSmallScreenCompat:
      // false` and `WeekAgenda` / `MonthAgenda` as small-only; when the
      // calendar element is < 700px wide the library auto-swaps to the
      // small-compatible variant from the same family. The dashboard's
      // week view doesn't fit on a phone otherwise (7 columns + time
      // axis), so this is the responsive layer.
      views: [
        createViewWeek(),
        createViewWeekAgenda(),
        createViewMonthGrid(),
        createViewMonthAgenda(),
      ],
      defaultView: "week",
      events: calendarEvents,
      calendars: CALENDARS_CONFIG,
      isDark,
      theme: "shadcn",
      plugins: [
        calendarControls,
        currentTimePlugin,
        scrollController,
        dragAndDropPlugin,
        resizePlugin,
      ],
      callbacks: {
        // NB: schedule-x's `onEventClick` is dispatched via the React
        // synthetic-event system on the rendered event div. With the
        // drag plugin loaded, schedule-x renders a *copy* event element
        // overlaid on the original during the 150ms drag-start window.
        // That copy can intercept the synthetic click after mouseup,
        // and the v3 OSS plugin's mouseup-handler async path also
        // mutates `eventCopy` state mid-flight — both paths can leave
        // the click event undelivered. We therefore handle event
        // clicks via a capture-phase listener on the calendar wrapper
        // (see the effect below this useState) and skip schedule-x's
        // own callback. Keeping `onEventClick` undefined makes the
        // hand-off explicit.
        // Block drag/resize on tasks — they aren't owned by the
        // dashboard calendar (the project calendar is the canonical
        // surface for rescheduling tasks via plannedStartDate).
        // Returning `false` aborts the move and snaps the event back
        // before any persistence happens.
        onBeforeEventUpdate(oldEvent) {
          if (!oldEvent || typeof oldEvent.id !== "string") return false;
          return oldEvent.id.startsWith("event-");
        },
        // Drag/resize commit. Dispatched through the ref trampoline so
        // the callback always reads the freshest events array, mutation
        // ref, and dialog state setter — the schedule-x calendar
        // instance is built once and would otherwise capture stale
        // closures.
        onEventUpdate(updated) {
          onEventUpdateRef.current(updated);
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

  // Document-level capture-phase click listener — resolves event
  // clicks ourselves so the drag plugin's mid-mouseup state mutation
  // can't drop them. Schedule-x v4's `onEventClick` is dispatched via
  // a preact synthetic onClick on a div that the v3 drag plugin's
  // updateCopy(undefined) call removes from the DOM during the
  // mouseup async path; that race leaves clicks undelivered.
  //
  // Using the wrapper ref was unreliable because schedule-x renders
  // the calendar via `calendarApp.render(element)` (preact taking
  // over a child node), and React's reconciliation around the
  // ScheduleXCalendar component can briefly null the ref. Listening
  // on `document` at capture-phase removes that timing dependency
  // entirely — every click in the page passes through here, and we
  // filter to the calendar's event elements via `data-event-id`.
  //
  // The ref-based "did the user actually drag?" check stays: we read
  // mousedown coordinates and compare to mouseup. If the cursor moved
  // > 4px the click is treated as a drag artifact (the drag plugin's
  // `onEventUpdate` handles persistence) and we no-op.
  //
  // Resolution timing — IMPORTANT: we resolve the event id at
  // `mousedown` and dispatch directly from `mouseup`, ignoring `click`
  // entirely. The two earlier strategies (resolve-at-click,
  // resolve-at-mouseup) both failed for full-width (solo) time-grid
  // events.
  //
  // Why mousedown is the only safe resolution point:
  // - At 150 ms of hold the calendar mounts a "copy" event div (sibling
  //   of the original) for the drag preview. The copy carries the same
  //   `data-event-id` and lands on top of the original for solo events.
  // - On mouseup the v3 plugin's document mouseup handler calls
  //   `updateCopy(undefined)` which detaches the copy via Preact
  //   re-render before the browser dispatches the synthetic `click`.
  // - When mouseup target ≠ mousedown target AND one of them is
  //   detached at click-dispatch time, browsers may skip `click`
  //   entirely (or fire it on a common ancestor that lacks
  //   `data-event-id`). Either way `click` cannot be relied on.
  // - Even at mouseup the target can already be a detached copy:
  //   `closest('[data-event-id]')` still returns the copy (the
  //   attribute is preserved) but `closest('.sx-react-calendar-wrapper')`
  //   walks up from a detached node and returns null.
  // - At mousedown the copy doesn't exist yet — the 150 ms drag-start
  //   timer hasn't fired. The target is unambiguously the original
  //   event div, attached, with a clean ancestor chain. We capture the
  //   event id here.
  //
  // Drag-vs-click filter stays: if mouseup moved > 4 px from mousedown
  // we treat it as a drag and don't dispatch (the drag plugin's
  // `onEventUpdate` handles persistence).
  //
  // We don't listen on `click` anymore — schedule-x's own onClick on
  // the event div calls `e.stopPropagation()` and we have
  // `onEventClick` undefined, so click is a no-op for our purposes.
  const tasksRef = React.useRef(tasks);
  React.useEffect(() => {
    tasksRef.current = tasks;
  });
  useEffect(() => {
    let downX = 0;
    let downY = 0;
    let downEventId: string | null = null;
    function handleMouseDown(e: MouseEvent) {
      downX = e.clientX;
      downY = e.clientY;
      downEventId = null;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Skip resize handles. The handle covers the bottom 20 px of
      // every event; small resize gestures may snap to the same time
      // slot and end with movement < 4 px, which would otherwise
      // trip the click-vs-drag check below and open the sheet on top
      // of a successful resize.
      if (
        target.closest(
          ".sx__time-grid-event-resize-handle, .sx__date-grid-event-resize-handle",
        )
      ) {
        return;
      }
      const eventEl = target.closest<HTMLElement>("[data-event-id]");
      if (!eventEl) return;
      // Only react to events inside the dashboard's own calendar
      // wrapper — the project calendar (and any other schedule-x
      // instance mounted simultaneously) also uses `data-event-id`,
      // and we don't want to hijack their clicks.
      if (!eventEl.closest(".sx-react-calendar-wrapper")) return;
      downEventId = eventEl.getAttribute("data-event-id");
    }
    function handleMouseUp(e: MouseEvent) {
      const id = downEventId;
      downEventId = null;
      if (!id) return;
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      // 4 px sits below typical click jitter; anything more is a drag.
      if (dx > 4 || dy > 4) return;
      if (id.startsWith("task-")) {
        const taskId = id.slice(5) as Id<"tasks">;
        const match = tasksRef.current?.find((t) => t._id === taskId);
        setSelectedTaskId(taskId);
        setSelectedTaskProjectId(match?.projectId ?? null);
      } else if (id.startsWith("event-")) {
        setSelectedEventId(id.slice(6) as Id<"calendarEvents">);
      }
    }
    // Prevent native HTML5 text-drag from hijacking schedule-x's
    // time-grid drag. The time-grid event div has no `draggable`
    // attribute (unlike date-grid / month-grid events, which DO use
    // HTML5 native drag intentionally), so any dragstart originating
    // inside `.sx__time-grid-event` is the browser starting a
    // text-drag on selected text. Browsers suppress `mousemove`
    // during native drag, which means the v3 drag plugin's mousemove
    // listener never fires and the event copy stops following the
    // cursor — the visible symptom is "text follows cursor but the
    // event block stays still". Cancelling dragstart here lets the
    // mouse-event drag flow through unimpaired. We must NOT cancel
    // dragstart for date-grid / month-grid events: those rely on
    // HTML5 dragend for their drag commit (see
    // DateGridDragHandlerImpl / MonthGridDragHandlerImpl in
    // @schedule-x/drag-and-drop).
    function handleDragStart(e: DragEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".sx-react-calendar-wrapper")) return;
      if (target.closest(".sx__time-grid-event")) {
        e.preventDefault();
      }
    }
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("dragstart", handleDragStart, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("dragstart", handleDragStart, true);
    };
  }, []);

  // Resolve the user's choice from the notify-invitees dialog.
  //   • send   → persist + notify (in-app + email guests)
  //   • silent → persist only (no notifications)
  //   • revert → roll back the schedule-x visual state to the snapshot
  //              we captured before opening the dialog. Convex's
  //              reactivity would eventually pull the original times
  //              back, but we're more responsive doing it locally — the
  //              user's eye is already on the event.
  const handleRescheduleChoice = (choice: RescheduleChoice) => {
    const attempt = pendingReschedule;
    if (!attempt) return;
    setPendingReschedule(null);

    if (choice === "revert") {
      try {
        calendarApp.events.update(attempt.original);
      } catch {
        // If schedule-x rejects the manual update (event removed in the
        // meantime, etc.), the diff effect will re-sync on the next
        // events query update — at worst a brief visual lag.
      }
      return;
    }

    void updateEventMutation({
      eventId: attempt.eventId,
      startsAt: attempt.newStartsAt,
      endsAt: attempt.newEndsAt,
      notifyInvitees: choice === "send",
    }).catch((err: unknown) => {
      // Persistence failed — revert the visual so the calendar stays
      // truthful with the server, then surface the error.
      try {
        calendarApp.events.update(attempt.original);
      } catch {
        /* noop */
      }
      toast.error("Could not reschedule", {
        description: getErrorMessage(err),
      });
    });
  };

  // Mobile event-detail routing: when an event is selected on mobile —
  // either via deep-link seed (queryEventId) or a runtime click on the
  // calendar — render <Navigate> to push the user onto the dedicated
  // /events/:id page. Sheets on a phone are too constrained for the
  // 5-section event surface; the page mirrors TaskDetailPage's
  // mobile-first layout. Render-time Navigate avoids both the
  // setState-in-effect lint and the captured-closure bug schedule-x
  // would have if we did the dispatch in the onEventClick callback.
  if (isMobile && selectedEventId) {
    return (
      <Navigate
        to={`/workspaces/${workspaceId}/events/${selectedEventId}`}
        replace
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-3">
      {/* Mobile-only "New event" trigger — promoted to the global app
          header so the calendar's own header (rendered by schedule-x
          inside the grid) doesn't have to fight for horizontal space.
          Desktop renders the same affordance inline in CalendarHeader. */}
      {isMobile && (
        <HeaderSlot>
          <Button
            size="sm"
            onClick={() => setOpenCreate(true)}
            aria-label="New event"
          >
            <Plus className="h-4 w-4 mr-1" />
            <span>New event</span>
          </Button>
        </HeaderSlot>
      )}

      {/* Calendar grid — fills remaining height. The header context feeds
          our custom `headerContent` slot (prev/next, label, counters,
          New event, view switcher) — see CalendarHeader. */}
      <CalendarHeaderContext.Provider
        value={{
          calendarControls,
          rangeVersion,
          view,
          setView: switchView,
          eventCount: events ? events.length : null,
          onCreateEvent: () => setOpenCreate(true),
        }}
      >
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
      {/* Notify-invitees prompt for drag-to-reschedule + resize. Only
          mounted while a reschedule is in flight — no `*Mounted` ratchet
          needed because the dialog is small and resolves quickly (close
          animation plays via the dialog's own `onOpenChange`-driven
          revert path). */}
      {pendingReschedule && (
        <NotifyInviteesDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) handleRescheduleChoice("revert");
          }}
          eventTitle={pendingReschedule.title}
          oldRangeLabel={formatRescheduleRange(
            pendingReschedule.oldStartsAt,
            pendingReschedule.oldEndsAt,
          )}
          newRangeLabel={formatRescheduleRange(
            pendingReschedule.newStartsAt,
            pendingReschedule.newEndsAt,
          )}
          inviteeCount={pendingReschedule.inviteeCount}
          onChoose={handleRescheduleChoice}
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

/** Compact "Mon, May 4 · 10:00 AM – 11:00 AM" range used by the
 *  notify-invitees dialog's before/after summary. Locale-driven so the
 *  organizer sees their own clock format (12h vs 24h). */
function formatRescheduleRange(startsAt: number, endsAt: number): string {
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
}

/** Inverse of `msToZonedDateTime` — schedule-x hands its drag/resize
 *  callbacks Temporal `ZonedDateTime` (timed events) or `PlainDate`
 *  (all-day) instances. The events lane in the dashboard is always
 *  timed, but accept both shapes defensively so type narrowing
 *  doesn't trip on a stray PlainDate. */
function temporalToMs(t: unknown): number {
  if (t instanceof Temporal.ZonedDateTime) return t.epochMilliseconds;
  if (t instanceof Temporal.PlainDate) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return t.toZonedDateTime({ timeZone: tz }).epochMilliseconds;
  }
  // Last-resort: schedule-x sometimes hands strings on legacy paths.
  return new Date(String(t)).getTime();
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
