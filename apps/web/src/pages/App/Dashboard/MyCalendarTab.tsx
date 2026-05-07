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
import { toast } from "sonner";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { isHistoricalReschedule } from "@/lib/calendar-utils";
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
  DAY_MINUTES,
  SLOT_MINUTES,
} from "../Calendar/calendar-grid-constants";
import { parseScheduleXEventId } from "../Calendar/scheduleXEventId";
import {
  msToZonedDateTime,
  temporalToMs,
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

  // Click/drag-to-create state for the time grid (week view). The
  // popover surface (`<InlineEventCreator />`) replaces the dialog for
  // this flow — anchored to a ghost event the user is actively
  // sketching out. Lifecycle:
  //   1. `onMouseDownDateTime` (schedule-x callback below) seeds this
  //      with phase="dragging" + the day column + start ms.
  //   2. A document-level mousemove listener (effect below) updates
  //      `endMs` as the cursor moves, growing the ghost in real time.
  //   3. The matching mouseup listener decides drag vs click and
  //      transitions phase to "creating" (which mounts the popover
  //      with the form), or — for very short drags — keeps the start
  //      and bumps the end to start+1h (click-to-create).
  //   4. Submitting the form or dismissing the popover clears state.
  type CreatorState = {
    phase: "dragging" | "creating";
    dayColumn: HTMLElement;
    startMs: number;
    endMs: number;
    /** Mouse-down coords for the click-vs-drag decision at mouseup. */
    downX: number;
    downY: number;
  };
  const [creator, setCreator] = useState<CreatorState | null>(null);

  // Begin a drag-to-create. Attaches the document-level mousemove +
  // mouseup listeners SYNCHRONOUSLY inside this call rather than via a
  // useEffect keyed on `creator.phase`.
  //
  // Why synchronous: schedule-x's `onMouseDownDateTime` callback runs
  // inside its preact event handler. We schedule a React state update
  // there, but React batches and may not flush + commit + run effects
  // before the browser dispatches the matching mouseup. For a fast
  // click (mousedown → mouseup ≈ 0–10 ms), the mouseup beats React's
  // effect commit and the listener is never attached — symptom: the
  // popover never advances from drag-ghost to creating phase.
  // Attaching listeners here closes the timing gap entirely.
  //
  // React state setters are referentially stable, so closing over
  // `setCreator` from the lazy `createCalendar` initializer below is
  // safe even though this function is invoked many renders later.
  function beginCreator(init: {
    dayColumn: HTMLElement;
    downX: number;
    downY: number;
  }) {
    const { dayColumn, downX, downY } = init;
    const colDateStr = dayColumn.getAttribute("data-time-grid-date");
    if (!colDateStr) return;
    const dayStartMs = new Date(`${colDateStr}T00:00`).getTime();
    if (Number.isNaN(dayStartMs)) return;

    const SLOT_MIN = SLOT_MINUTES;
    const DAY_MIN = DAY_MINUTES;

    function cursorYToEpochMs(clientY: number): number {
      const colRect = dayColumn.getBoundingClientRect();
      const offsetY = Math.max(
        0,
        Math.min(colRect.height, clientY - colRect.top),
      );
      const minutesRaw = (offsetY / colRect.height) * DAY_MIN;
      // Snap to 15-min grid so the ghost lands on a TimeSelect-valid
      // option (the form's pickers don't expose finer steps anyway).
      const minutes = Math.max(
        0,
        Math.min(DAY_MIN, Math.round(minutesRaw / SLOT_MIN) * SLOT_MIN),
      );
      return dayStartMs + minutes * 60 * 1000;
    }

    // Derive the start from the cursor Y rather than schedule-x's
    // `dateTime.epochMilliseconds` — schedule-x's value is computed
    // at its `timePointsPerDay` resolution (1-min by default) and
    // would land on whatever exact pixel the user clicked. Using
    // `cursorYToEpochMs` snaps to the same 15-min grid the
    // `<CursorTimeIndicator />` displays, so the ghost that appears
    // on mouseup starts exactly where the hover hint promised.
    const startMs = cursorYToEpochMs(downY);

    function onMove(e: MouseEvent) {
      const newEndMs = cursorYToEpochMs(e.clientY);
      setCreator((prev) =>
        prev && prev.phase === "dragging"
          ? { ...prev, endMs: newEndMs }
          : prev,
      );
    }

    function onUp(e: MouseEvent) {
      // Detach immediately so the same drag can't accidentally fire
      // twice (defensive — mouseup is normally one-shot).
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      // Swallow the `click` event that follows this mouseup. base-ui's
      // Popover uses floating-ui's `useDismiss` with
      // `outsidePressEvent: 'intentional'`, which registers a
      // capture-phase `click` listener on the document that fires
      // `onOpenChange(false)` when the click target is outside the
      // popup. The popup mounts in a React microtask between this
      // mouseup and the browser's `click` dispatch — meaning the
      // click we generated by ending the drag is interpreted as an
      // outside-press dismiss the moment the popup appears, closing
      // it before the user can see it.
      //
      // Suppression mechanics:
      //   - We register on `document` in capture phase, BEFORE base-ui
      //     gets a chance to (its registration runs in the
      //     `useEffect` that fires after render commit, which happens
      //     after this synchronous code finishes).
      //   - `stopImmediatePropagation` prevents other capture-phase
      //     listeners on the same node — including base-ui's — from
      //     running. `stopPropagation` alone wouldn't, since multiple
      //     capture listeners on the same element fire in
      //     registration order regardless of bubbling.
      //   - One-shot self-removal: even if no click follows (rare,
      //     e.g. drag ends with a focus change), the listener is
      //     cleaned up after the next click anywhere on the page.
      function suppressNextClick(ev: MouseEvent) {
        ev.stopImmediatePropagation();
        document.removeEventListener("click", suppressNextClick, true);
      }
      document.addEventListener("click", suppressNextClick, true);

      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      const isClick = dx < 4 && dy < 4;
      setCreator((prev) => {
        if (!prev || prev.phase !== "dragging") return prev;
        let nextStart = startMs;
        let nextEnd = isClick
          ? // Click-to-create: same 15-min ghost the drag preview
            // shows. Avoids the visual "jump" from 15 min during the
            // press to 60 min on release; users who want a longer
            // event drag the slot or extend the end picker.
            startMs + SLOT_MIN * 60 * 1000
          : prev.endMs;
        if (!isClick && nextEnd <= nextStart) {
          // Dragged upward — swap so start < end. Without this the
          // ghost rect would have negative height and the form's
          // submit logic would treat it as "spans midnight" — wrong
          // semantic for a same-day selection.
          [nextStart, nextEnd] = [nextEnd, nextStart];
        }
        if (!isClick && nextEnd - nextStart < SLOT_MIN * 60 * 1000) {
          // Drag-distance < one slot — snap to a single-slot ghost
          // rather than producing a sub-15-min event the form can't
          // represent cleanly.
          nextEnd = nextStart + SLOT_MIN * 60 * 1000;
        }
        return {
          ...prev,
          phase: "creating" as const,
          startMs: nextStart,
          endMs: nextEnd,
        };
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    setCreator({
      phase: "dragging",
      dayColumn,
      startMs,
      // Seed `endMs` at start + 15 min so the ghost is visible on the
      // very first frame; the first mousemove tick overrides it.
      endMs: startMs + 15 * 60 * 1000,
      downX,
      downY,
    });
  }
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
      const parsed = parseScheduleXEventId(id);
      if (parsed?.kind !== "event") return; // tasks blocked at onBeforeEventUpdate
      const eventId = parsed.id;
      const sourceEvent = events?.find((e) => e._id === eventId);
      if (!sourceEvent) return;

      // Schedule-x emits start/end as Temporal types; convert to ms.
      const newStartsAt = temporalToMs(updated.start);
      const newEndsAt = temporalToMs(updated.end);
      if (newStartsAt === sourceEvent.startsAt && newEndsAt === sourceEvent.endsAt) {
        return; // no-op (drag aborted or returned to original cell)
      }

      const inviteeCount = sourceEvent.nonOrganizerInviteeCount;
      // Past→past edits are organizer history-cleanup, not real
      // schedule changes — silent write regardless of invitee count.
      // Server applies the same predicate as a safety net for
      // non-dashboard edit paths.
      const historical = isHistoricalReschedule(
        sourceEvent.startsAt,
        newStartsAt,
        Date.now(),
      );
      // No external eyes on the event → just write through. The
      // organizer's own calendar updates reactively from convex.
      if (inviteeCount === 0 || historical) {
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

  // Background-events sync. Schedule-x v4 exposes no public mutator for
  // its background-events list; the project calendar (cycles overlay)
  // works around this by reaching into `$app.calendarEvents.backgroundEvents`
  // — see `useCalendarSync.ts`. We replicate that here. The key-ref
  // gate keeps the assignment O(1) on no-op renders.
  const bgEventsKeyRef = React.useRef("");
  React.useEffect(() => {
    const key = backgroundEvents
      .map(
        (e) =>
          `${String(e.start)}|${String(e.end)}|${(e.style as Record<string, string> | undefined)?.background ?? ""}`,
      )
      .join(",");
    if (key === bgEventsKeyRef.current) return;
    bgEventsKeyRef.current = key;
    (calendarApp as unknown as {
      $app: {
        calendarEvents: {
          backgroundEvents: { value: BackgroundEvent[] };
        };
      };
    }).$app.calendarEvents.backgroundEvents.value = backgroundEvents;
  }, [calendarApp, backgroundEvents]);

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
      const parsed = parseScheduleXEventId(id);
      if (parsed?.kind === "task") {
        const match = tasksRef.current?.find((t) => t._id === parsed.id);
        setSelectedTaskId(parsed.id);
        setSelectedTaskProjectId(match?.projectId ?? null);
      } else if (parsed?.kind === "event") {
        setSelectedEventId(parsed.id);
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
          onClose={() => setCreator(null)}
          onTimesChange={(start, end) =>
            setCreator((prev) =>
              prev
                ? { ...prev, startMs: start.getTime(), endMs: end.getTime() }
                : prev,
            )
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

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

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

// EmptyOverlay extracted to ./EmptyOverlay.tsx
