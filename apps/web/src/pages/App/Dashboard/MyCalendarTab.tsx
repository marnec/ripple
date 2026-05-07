import React, { Suspense, useEffect, useMemo, useState } from "react";
import {
  createCalendar,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
  createViewWeekAgenda,
  type BackgroundEvent,
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
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisibleMemberCalendars } from "@/hooks/use-visible-member-calendars";
import { useViewer } from "@/pages/App/UserContext";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryParams } from "@ripple/shared/types/routes";
import "../Project/project-calendar.css";

import { type MemberCalendarMember } from "./MemberCalendarFilter";
import { memberBlockStyle } from "./member-calendar-colors";
import { CalendarHeader } from "./CalendarHeader";
import {
  CalendarHeaderContext,
  type DashboardCalendarView,
} from "./calendar-header-context";
import { EmptyOverlay } from "./EmptyOverlay";
import { useEventDragCreate } from "./hooks/useEventDragCreate";
import { useEventReschedule } from "./hooks/useEventReschedule";
import { useScheduleXEventBinding } from "./hooks/useScheduleXEventBinding";
import { useEventClickResolution } from "./hooks/useEventClickResolution";

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
import { InlineEventCreator } from "../Calendar/InlineEventCreator";
import { CursorTimeIndicator } from "../Calendar/CursorTimeIndicator";
import {
  NotifyInviteesDialog,
  type RescheduleChoice,
} from "../Calendar/NotifyInviteesDialog";
import {
  formatRescheduleRange,
  msToZonedDateTime,
} from "../Calendar/event-time-utils";

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

  // ── Member calendar overlay (busy-blocks behind own events) ──────────
  // Persisted per-workspace in localStorage so the overlay survives reloads
  // without a server round-trip. Cross-tab sync rides on StorageEvent.
  const [visibleMemberIds, setVisibleMemberIds] =
    useVisibleMemberCalendars(workspaceId);
  const viewer = useViewer();
  const allMembers = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  // Strip the viewer themselves — their own events are the foreground
  // lane; overlaying them on top of themselves is meaningless.
  const filterableMembers: MemberCalendarMember[] | null = useMemo(() => {
    if (!allMembers) return null;
    return allMembers
      .filter((m) => m.userId !== viewer?._id)
      .map((m) => ({
        userId: m.userId,
        name: m.name ?? m.email ?? "Unknown",
        email: m.email,
        image: m.image,
      }));
  }, [allMembers, viewer?._id]);
  // Defensive narrowing: stale localStorage ids (member removed since the
  // pref was saved) shouldn't make it into the query — Convex would
  // reject them via getWorkspaceMembership anyway, but we'd rather not
  // make that round-trip. If everything filtered out we collapse to []
  // so the query is "skip"-eligible below.
  const liveVisibleMemberIds = useMemo(() => {
    if (!filterableMembers) return visibleMemberIds;
    const live = new Set(filterableMembers.map((m) => m.userId));
    return visibleMemberIds.filter((id) => live.has(id));
  }, [filterableMembers, visibleMemberIds]);

  const memberBusyBlocks = useQuery(
    api.calendarEvents.listForMembersInRange,
    liveVisibleMemberIds.length > 0
      ? {
          workspaceId,
          memberIds: liveVisibleMemberIds,
          rangeStartMs,
          rangeEndMs,
        }
      : "skip",
  );

  const [openCreate, setOpenCreate] = useState(false);
  // Seeds the start-time defaults inside CreateEventDialog. `null` ⇒ the
  // dialog falls back to "now + 1h rounded to the next 15-min slot".
  // Used by the "+ New event" button in the header and by month-grid
  // empty-cell clicks (the time grid uses a popover-anchored ghost
  // flow instead — see `creator` below).
  const [createInitialDate, setCreateInitialDate] = useState<Date | null>(null);

  // Click/drag-to-create state machine for the time grid (week view).
  // The popover surface (`<InlineEventCreator />`) replaces the dialog
  // for this flow — anchored to a ghost event the user is actively
  // sketching out. The hook owns the synchronous-document-listener
  // trick (mousemove/mouseup attached during the originating mousedown
  // to beat React batching), the 4 px click-vs-drag threshold, and the
  // snap-to-SLOT_MINUTES math; see useEventDragCreate.ts for details.
  const { creator, beginCreator, dismissCreator, setCreatorTimes } =
    useEventDragCreate();

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

  // Background events derived from the member-calendar overlay query.
  // Title is intentionally empty: schedule-x renders BackgroundEvents
  // without an event card, so no copy ever leaks colleague event names
  // — only their busy time. Per-member tinting comes from `style`,
  // hashed deterministically in `memberBlockStyle`.
  const backgroundEvents = useMemo<BackgroundEvent[]>(() => {
    if (!memberBusyBlocks) return [];
    return memberBusyBlocks.map((b) => ({
      title: "",
      start: msToZonedDateTime(b.startsAt),
      end: msToZonedDateTime(b.endsAt),
      style: memberBlockStyle(b.memberId),
    }));
  }, [memberBusyBlocks]);

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

  // Mutation handle for the reschedule hook (drag/resize commit) and
  // for any other inline persistence path the tab might grow later.
  const updateEventMutation = useMutation(api.calendarEvents.update);

  // Ref-trampoline for schedule-x's drag/resize commit callback. The
  // calendar instance is built once in `useState`'s lazy initializer
  // below, so any callback we put on its config closes over the FIRST
  // render's closure. The ref is updated on every render (effect after
  // `useEventReschedule`) so the committed handler always reads the
  // freshest events array, mutation reference, etc. Lives here rather
  // than inside `useEventReschedule` because schedule-x's plugin
  // callback registry captures its callback at plugin construction
  // time — replacing the ref with a hook return value would break the
  // fresh-state read pattern.
  const onEventUpdateRef = React.useRef<(updated: { id: string | number; start: unknown; end: unknown }) => void>(() => {});

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
      // Schedule-x's `timezone` config defaults to 'UTC'. When events
      // are passed as `ZonedDateTime` in the user's local zone (see
      // `msToZonedDateTime`) but the calendar grid is rendered in UTC,
      // every coordinate emitted by schedule-x's click/mousedown
      // callbacks is a UTC moment — its `epochMilliseconds` resolves
      // to a different wall-clock when fed back through `new Date()`.
      // For a user in UTC+2 the click-to-create ghost landed 2 h later
      // than the cursor; aligning schedule-x's grid with the user's
      // local zone fixes both labelling and click coordinates in one
      // step. Falls back to "UTC" when the browser doesn't expose a
      // resolved zone (very old Safari / locked-down environments).
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
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
        // Month-grid empty-cell click → open the create dialog
        // pre-anchored to the clicked day. The time grid uses the
        // ghost+popover flow (see `onMouseDownDateTime` below) instead,
        // but the month grid has no native concept of a time slot, so
        // dragging a ghost over a multi-day range would mean a
        // multi-day event — out of scope here. Schedule-x dispatches
        // this callback only on truly empty space; event divs absorb
        // pointer events before they bubble to the cell, so we don't
        // need a "did the user click an event?" guard.
        // React state setters are referentially stable, so capturing
        // them in this lazy initializer is safe across re-renders.
        onClickDate(date) {
          // Seed at noon so the dialog's round-to-next-15-min logic
          // produces a clean 12:00 start rather than landing in the
          // past for users browsing today.
          const seed = new Date(
            date.year,
            date.month - 1,
            date.day,
            12,
            0,
            0,
            0,
          );
          setCreateInitialDate(seed);
          setOpenCreate(true);
        },
        // Time-grid mousedown → start drag-to-create. `beginCreator`
        // attaches the document mousemove + mouseup listeners
        // synchronously and seeds the creator state in one shot — see
        // its definition above for why the listeners can't live in a
        // useEffect (preact-driven setState may not commit before the
        // browser dispatches the matching mouseup on a fast click).
        // `preventDefault` suppresses native text-selection during
        // the drag.
        // `dateTime` is intentionally unused — `beginCreator` derives
        // the start time from the cursor Y instead, snapping to the
        // same 15-min grid the `<CursorTimeIndicator />` shows. See
        // the comment on `cursorYToEpochMs` inside `beginCreator`.
        onMouseDownDateTime(_dateTime, e) {
          // Ignore non-primary buttons — right-click / middle-click
          // shouldn't open a create popover.
          if (e.button !== 0) return;
          e.preventDefault();
          const target = e.target;
          if (!(target instanceof Element)) return;
          const col = target.closest<HTMLElement>("[data-time-grid-date]");
          if (!col) return;
          beginCreator({
            dayColumn: col,
            downX: e.clientX,
            downY: e.clientY,
          });
        },
      },
    }),
  );

  // Reschedule decision flow + modal staging. Owned by useEventReschedule:
  // the silent-vs-prompted branching (invitee count + historical-edit
  // predicate), the optimistic revert path, and the `pendingReschedule`
  // modal state. We thread `handleEventUpdate` into `onEventUpdateRef`
  // (effect below) so the schedule-x callback registry — which captured
  // its callback at plugin construction time, above — calls the freshest
  // handler on every commit.
  const {
    pendingReschedule,
    handleEventUpdate,
    sendReschedule,
    persistSilently,
    revertReschedule,
  } = useEventReschedule({
    events,
    updateEvent: updateEventMutation,
    calendarApp,
    eventCalendarId: CAL_EVENT,
  });
  React.useEffect(() => {
    onEventUpdateRef.current = handleEventUpdate;
  });

  // Sync React-state event arrays into the schedule-x instance. The
  // hook owns the diff loop for foreground events and the v4 private-
  // state cast for background events — see useScheduleXEventBinding.ts
  // for the upgrade-zone documentation.
  useScheduleXEventBinding({
    calendarApp,
    events: calendarEvents,
    backgroundEvents,
  });

  // Document-level click resolver. The hook attaches capture-phase
  // mousedown/mouseup/dragstart listeners and resolves dashboard-
  // calendar event clicks despite the v3 drag plugin's mid-mouseup DOM
  // mutation that drops schedule-x's own onEventClick. See
  // useEventClickResolution.ts for the full timing rationale.
  useEventClickResolution({
    tasks,
    onTaskClick: (taskId, projectId) => {
      setSelectedTaskId(taskId);
      setSelectedTaskProjectId(projectId);
    },
    onEventClick: (eventId) => {
      setSelectedEventId(eventId);
    },
  });

  // Resolve the user's choice from the notify-invitees dialog.
  //   • send   → persist + notify (in-app + email guests)
  //   • silent → persist only (no notifications)
  //   • revert → roll back the schedule-x visual state to the snapshot
  //              we captured before opening the dialog
  // Hook owns the actual mechanics — see useEventReschedule.ts.
  const handleRescheduleChoice = (choice: RescheduleChoice) => {
    if (choice === "send") sendReschedule();
    else if (choice === "silent") persistSilently();
    else revertReschedule();
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
          filterableMembers,
          visibleMemberIds: liveVisibleMemberIds,
          setVisibleMemberIds,
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
          onOpenChange={(o) => {
            setOpenCreate(o);
            // Drop the seed when the dialog closes so the next "New
            // event" button click reverts to the "now + 1h" default,
            // rather than re-using the last empty-cell anchor.
            if (!o) setCreateInitialDate(null);
          }}
          initialDate={createInitialDate ?? undefined}
          // When the viewer is overlaying colleague calendars, pre-select
          // those colleagues as invitees on creation. Removable in the
          // form before submit — see CreateEventForm.
          initialMemberIds={liveVisibleMemberIds}
        />
      )}
      {/* Hover hint — a snapped "+ create here" bar that follows the
          cursor over empty time-grid cells. Tracking is paused
          (`active={false}`) while a drag/create is in flight; the
          ghost takes over the visual role then, and the indicator
          would just be visual noise behind the popover. Mobile users
          don't get hover, so the listener is a no-op there. */}
      {!isMobile && (
        <CursorTimeIndicator active={creator === null} />
      )}
      {/* Click/drag-to-create surface for the time grid. Mounted only
          while the user has an active gesture in flight — there's no
          mounted-flag ratchet because the surface is transient by
          design (no animation cost on close). The popover handles
          its own exit animation via base-ui's data-closed transitions
          before unmount. */}
      {creator && (
        <InlineEventCreator
          workspaceId={workspaceId}
          dayColumn={creator.dayColumn}
          startMs={creator.startMs}
          endMs={creator.endMs}
          phase={creator.phase}
          onClose={dismissCreator}
          onTimesChange={(start, end) =>
            setCreatorTimes(start.getTime(), end.getTime())
          }
          // Pre-invite the colleagues whose calendars are currently
          // overlaid — same as the dialog flow above. Compact form
          // surfaces a one-line summary instead of the full picker.
          initialMemberIds={liveVisibleMemberIds}
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

