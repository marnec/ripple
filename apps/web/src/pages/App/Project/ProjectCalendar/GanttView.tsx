import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gantt, Willow, WillowDark } from "@svar-ui/react-gantt";
import type { IApi, ITask } from "@svar-ui/react-gantt";
import { Temporal } from "temporal-polyfill";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { estimateToDays, addCalendarDays } from "@/lib/calendar-utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  CalendarSidebarProvider,
  CalendarSidebar,
  CalendarSidebarInset,
  CalendarSidebarHeader,
  CalendarSidebarContent,
} from "@/components/ui/calendar-sidebar";
import { calendarDragContext } from "../calendarDragContext";
import { CalendarTaskMenuContext } from "./calendar-contexts";
import { UnscheduledTaskList } from "./CalendarSidebarLists";
import { type EnrichedTask, PRIORITY_COLORS, formatDayTitle } from "./calendar-events";
import type { GanttViewMode } from "./ScheduleHeader";
import "@svar-ui/react-gantt/all.css";
import "../project-gantt.css";

// Imperative handle the shared header uses to drive navigation.
export type GanttApi = {
  scrollToday: () => void;
  prev: () => void;
  next: () => void;
};

export type GanttDependency = {
  edgeId: string;
  sourceId: string;
  targetId: string;
};

// How far prev/next pages, in columns, per resolution (one column = one unit
// of the active view mode).
const PAGE_COLUMNS: Record<GanttViewMode, number> = { Day: 7, Week: 4, Month: 3 };

const CELL_WIDTH: Record<GanttViewMode, number> = { Day: 42, Week: 80, Month: 120 };

// Grid shows only the task name — drop SVAR's default Start date / Duration
// columns (the timeline already conveys both) — and reserve little width for it.
const GRID_COLUMNS = [{ id: "text", header: "Task name", flexgrow: 1, sort: true }];
const GRID_WIDTH = 200;

// Scale rows per resolution. The lowest row's unit drives bar granularity.
function scalesFor(mode: GanttViewMode) {
  if (mode === "Day")
    return [
      { unit: "month" as const, step: 1, format: "%F %Y" },
      { unit: "day" as const, step: 1, format: "%j" },
    ];
  if (mode === "Week")
    return [
      { unit: "month" as const, step: 1, format: "%F %Y" },
      { unit: "week" as const, step: 1, format: "%d %M" },
    ];
  return [
    { unit: "year" as const, step: 1, format: "%Y" },
    { unit: "month" as const, step: 1, format: "%M" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure builders
// ─────────────────────────────────────────────────────────────────────────────

function jsDateToISO(d: Date): string {
  return Temporal.PlainDate.from({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  }).toString();
}

function isoToJsDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function buildSvarTasks(scheduled: EnrichedTask[], multiplier: 1 | 5): ITask[] {
  return scheduled.map((t) => {
    const days = estimateToDays(t.estimate, multiplier);
    const start = isoToJsDate(t.plannedStartDate!);
    const end = isoToJsDate(addCalendarDays(t.plannedStartDate!, days));
    return {
      id: t._id,
      text: t.title,
      start,
      end,
      duration: days,
      progress: t.completed ? 100 : 0,
      type: "task",
      parent: 0,
    };
  });
}

function buildSvarLinks(deps: GanttDependency[]) {
  // edge: source *blocks* target ⇒ source must finish before target starts
  // ⇒ end-to-start link from source to target.
  return deps.map((d) => ({
    id: d.edgeId,
    source: d.sourceId,
    target: d.targetId,
    type: "e2s" as const,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GanttView({
  scheduledTasks,
  unscheduledTasks,
  dependencies,
  viewMode,
  multiplier,
  drawerOpen,
  onDrawerOpenChange,
  apiRef,
  onEmptyClick,
  isDark,
}: {
  scheduledTasks: EnrichedTask[];
  unscheduledTasks: EnrichedTask[];
  dependencies: GanttDependency[];
  viewMode: GanttViewMode;
  multiplier: 1 | 5;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  apiRef: React.RefObject<GanttApi | null>;
  /** Click on an empty timeline slot → schedule picker for that date (mobile). */
  onEmptyClick: (date: string) => void;
  isDark: boolean;
}) {
  const updateTask = useMutation(api.tasks.update);
  const createEdge = useMutation(api.edges.createEdge);
  const removeEdge = useMutation(api.edges.removeEdge);
  const isMobile = useIsMobile();
  // Same action menu the calendar uses (View task details / Unschedule).
  const taskMenu = useContext(CalendarTaskMenuContext);

  const svarApiRef = useRef<IApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the chart hidden until SVAR has finished its first layout + scroll
  // pass, then fade it in. Avoids showing the progressive render and the
  // scroll-to-range jump (the "layout shift" on mount).
  const [ready, setReady] = useState(false);

  // Container width, tracked so we can keep the date range at least as wide as
  // the chart area (see the start/end memo: prevents SVAR's fractional cellWidth
  // stretch). Measuring the *outer* container — which the built-in grid splitter
  // never resizes — means dragging that splitter can't reintroduce the stretch.
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Single-click context menu, anchored at the click position. Single click on
  // a bar fires SVAR's built-in `select-task` (which we leave untouched) — we
  // additionally open this menu. Double-click still opens the detail sheet (via
  // `show-editor`), so a short timer disambiguates: `show-editor` cancels the
  // pending menu.
  //
  // This is a hand-rolled portal menu, NOT a base-ui dropdown: SVAR focuses the
  // selected bar a tick after the click, and base-ui's menu auto-dismisses when
  // focus leaves its popup (reported as an `outside-press`, indistinguishable
  // from a real click-away) — so the menu vanished instantly. Owning dismissal
  // ourselves (outside pointerdown + Escape only) makes it immune to focus moves.
  const [menu, setMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const menuTimerRef = useRef<number | null>(null);
  const menuElRef = useRef<HTMLDivElement>(null);
  // Pointer gesture tracking: where the press started + whether it moved (a
  // drag/resize, not a click — suppresses the menu).
  const gestureRef = useRef({ x: 0, y: 0, moved: false });

  // Clear any pending menu timer on unmount.
  useEffect(() => () => { if (menuTimerRef.current) window.clearTimeout(menuTimerRef.current); }, []);

  // Dismiss the menu on a genuine outside press or Escape — but never on focus
  // changes (SVAR's post-select focus must not close it). Listeners attach only
  // while open; the opening click is already long past (220ms timer), so there's
  // no race with it.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuElRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  // Latest-value ref so the once-registered SVAR listeners never go stale.
  const multiplierRef = useRef(multiplier);
  useEffect(() => {
    multiplierRef.current = multiplier;
  });

  // SVAR's store.init() diffs config by *reference per key*, so keeping each
  // prop referentially stable (keyed by a content signature) means a data
  // change only re-applies the keys that actually changed — and scroll/zoom
  // survive. This is what lets drag/resize not fight Convex reactivity: we
  // persist only on release, so the tasks prop is stable during a gesture.
  const taskSig = scheduledTasks
    .map((t) => `${t._id}:${t.plannedStartDate}:${t.estimate ?? ""}:${t.completed ? 1 : 0}:${t.title}`)
    .join("|");
  const depSig = dependencies.map((d) => `${d.edgeId}:${d.sourceId}>${d.targetId}`).join("|");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => buildSvarTasks(scheduledTasks, multiplier), [taskSig, multiplier]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const links = useMemo(() => buildSvarLinks(dependencies), [depSig]);
  const scales = useMemo(() => scalesFor(viewMode), [viewMode]);

  // Chart range — padded around the scheduled tasks (and today) so there's room
  // to scroll. Recomputed only when the spanning dates change.
  const rangeSig = (() => {
    if (scheduledTasks.length === 0) return "empty";
    let min = scheduledTasks[0].plannedStartDate!;
    let max = min;
    for (const t of scheduledTasks) {
      const s = t.plannedStartDate!;
      const e = addCalendarDays(s, estimateToDays(t.estimate, multiplier));
      if (s < min) min = s;
      if (e > max) max = e;
    }
    return `${min}|${max}`;
  })();
  const { start, end } = useMemo(() => {
    const today = Temporal.Now.plainDateISO().toString();
    let min = today;
    let max = today;
    for (const t of scheduledTasks) {
      const s = t.plannedStartDate!;
      const e = addCalendarDays(s, estimateToDays(t.estimate, multiplier));
      if (s < min) min = s;
      if (e > max) max = e;
    }
    const startISO = addCalendarDays(min, -14);
    let endISO = addCalendarDays(max, 30);

    // SVAR auto-stretches cellWidth to a *fractional*, viewport-dependent value
    // to fill the chart area when the date range is narrower than the available
    // width — but only when BOTH start and end are provided (its `qs()`:
    // `if (u < e) cellWidth = cellWidth * (e / u)`). A fractional column width
    // can't be matched by the DOM header cells or our CSS grid lines, so they
    // drift left-to-right, and the drift changes as the built-in grid splitter
    // resizes the chart area. Prevent the stretch by extending the range so its
    // pixel width always meets-or-exceeds the container: then `u >= e` and SVAR
    // keeps the integer cellWidth we set. We keep the natural +30d padding when
    // tasks already span wider than the viewport.
    const cellWidth = CELL_WIDTH[viewMode];
    const unitDays = viewMode === "Day" ? 1 : viewMode === "Week" ? 7 : 31;
    if (containerWidth > 0) {
      const minCols = Math.ceil(containerWidth / cellWidth) + 2;
      const fillEndISO = addCalendarDays(startISO, minCols * unitDays);
      if (fillEndISO > endISO) endISO = fillEndISO;
    }

    return { start: isoToJsDate(startISO), end: isoToJsDate(endISO) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSig, containerWidth, viewMode]);

  // Register store listeners exactly once (SVAR calls `init` a single time).
  const init = (svarApi: IApi) => {
    svarApiRef.current = svarApi;

    // Reschedule / resize. Fires repeatedly while dragging (inProgress) and
    // once on release — persist only on release.
    svarApi.on("update-task", (ev) => {
      if (ev.inProgress) return;
      const t = svarApi.getTask(ev.id);
      if (!t || !t.start) return;
      const days = Math.max(1, Math.round(t.duration ?? 1));
      void updateTask({
        taskId: ev.id as Id<"tasks">,
        plannedStartDate: jsDateToISO(t.start),
        estimate: Math.max(1, Math.round((days * 8) / multiplierRef.current)),
      });
    });

    // Dependency drawn between two bars → create a blocks edge.
    svarApi.on("add-link", (ev) => {
      const source = String(ev.link.source ?? "");
      const target = String(ev.link.target ?? "");
      if (!source || !target || source === target) return;
      void createEdge({
        taskId: source as Id<"tasks">,
        dependsOnTaskId: target as Id<"tasks">,
        type: "blocks",
      });
    });

    // Link removed in the chart → remove the backing edge (id === edgeId).
    // Newly-drawn links carry a temp numeric id until Convex round-trips;
    // only persisted links (string edge ids) map to a real edge.
    svarApi.on("delete-link", (ev) => {
      if (typeof ev.id !== "string") return;
      void removeEdge({ edgeId: ev.id as Id<"edges"> });
    });

    // Single click → open the action menu at the click position. SVAR's own
    // selection (the `select-task` default) is untouched; we only add the menu.
    // Deferred ~220ms so the `moved` flag has settled (a drag/resize suppresses
    // the menu) and the menu mounts after the click is fully dispatched.
    svarApi.on("select-task", (ev) => {
      const id = String(ev.id);
      // Clamp the anchor so a near-edge click keeps the menu on screen.
      const x = Math.min(gestureRef.current.x, window.innerWidth - 188);
      const y = Math.min(gestureRef.current.y, window.innerHeight - 96);
      if (menuTimerRef.current) window.clearTimeout(menuTimerRef.current);
      menuTimerRef.current = window.setTimeout(() => {
        menuTimerRef.current = null;
        if (gestureRef.current.moved) return; // was a drag/resize, not a click
        setMenu({ taskId: id, x: Math.max(8, x), y: Math.max(8, y) });
      }, 220);
    });

    // Disable SVAR's double-click editor entirely. We don't use the built-in
    // editor, and once it opens it leaves the task in an "editor" state that
    // makes SVAR re-fire `show-editor` on every subsequent click — which would
    // open the detail sheet on plain single clicks. Cancelling the action keeps
    // single click → action menu the only task interaction. The detail sheet is
    // still reachable via the menu's "View task details" item.
    svarApi.intercept("show-editor", () => false);

    // Reveal once the chart has been laid out and painted. A double rAF waits
    // one frame past SVAR's initial render/scroll so the fade-in shows the
    // finished chart, not its intermediate states.
    requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
  };

  // Expose navigation to the shared header.
  useEffect(() => {
    const scrollByPage = (dir: -1 | 1) => {
      const svarApi = svarApiRef.current;
      if (!svarApi) return;
      const state = svarApi.getState() as { scrollLeft?: number };
      const left = (state.scrollLeft ?? 0) + dir * CELL_WIDTH[viewMode] * PAGE_COLUMNS[viewMode];
      void svarApi.exec("scroll-chart", { left: Math.max(0, left) });
    };
    apiRef.current = {
      scrollToday: () => { void svarApiRef.current?.exec("scroll-chart", { date: new Date() }); },
      prev: () => scrollByPage(-1),
      next: () => scrollByPage(1),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, viewMode]);

  // Drop an unscheduled task onto the chart → schedule at the dropped date.
  function dateFromDropX(clientX: number): string | null {
    const svarApi = svarApiRef.current;
    const chart = containerRef.current?.querySelector<HTMLElement>(".wx-chart");
    if (!svarApi || !chart) return null;
    const scaleState = (svarApi.getState() as { _scales?: { start: Date; lengthUnitWidth: number; lengthUnit: string } })._scales;
    if (!scaleState?.lengthUnitWidth) return null;
    const rect = chart.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left + chart.scrollLeft);
    const units = Math.floor(x / scaleState.lengthUnitWidth);
    const base = scaleState.start;
    const baseISO = jsDateToISO(base);
    const unit = scaleState.lengthUnit;
    const days = unit === "day" ? units : unit === "week" ? units * 7 : unit === "month" ? units * 30 : units;
    return addCalendarDays(baseISO, days);
  }

  // Ghost card that follows the cursor while dragging an unscheduled task over
  // the chart (mirrors the schedule-x calendar's drag ghost).
  const [dragGhost, setDragGhost] = useState<{ taskId: string; x: number; y: number; date: string | null } | null>(null);
  const ghostTask = dragGhost ? unscheduledTasks.find((t) => t._id === dragGhost.taskId) : undefined;

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const taskId = calendarDragContext.currentTaskId;
    if (!taskId) return;
    setDragGhost({ taskId, x: e.clientX, y: e.clientY, date: dateFromDropX(e.clientX) });
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragGhost(null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragGhost(null);
    const taskId = e.dataTransfer.getData("task-id");
    calendarDragContext.clearDragTask();
    if (!taskId) return;
    const date = dateFromDropX(e.clientX);
    if (!date) return;
    void updateTask({ taskId: taskId as Id<"tasks">, plannedStartDate: date });
  }

  // Click an empty timeline slot → open the unscheduled-task picker for that
  // date (mirrors the calendar's click-a-day flow). Mobile-only: desktop keeps
  // the docked pool panel + drag. Ignore clicks that land on a bar/link.
  function handleChartClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".wx-chart")) return;
    if (target.closest(".wx-task, .wx-milestone, .wx-summary, .wx-link")) return;
    const date = dateFromDropX(e.clientX);
    if (date) onEmptyClick(date);
  }

  const Theme = isDark ? WillowDark : Willow;

  const poolList =
    unscheduledTasks.length === 0 ? (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        Nothing unscheduled — everything has a planned start.
      </p>
    ) : (
      <UnscheduledTaskList tasks={unscheduledTasks} />
    );

  return (
    <>
      {/* Right pushing sidebar — same mechanism as the calendar view. */}
      <CalendarSidebarProvider
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        className="flex-1 min-h-0 border-t"
      >
        <CalendarSidebarInset>
          {/* Chart area — the main element (no card): transparent so the page
              background shows, accepts drops from the unscheduled pool. */}
          <div
            ref={containerRef}
            className="ripple-gantt flex-1 min-h-0 overflow-hidden"
            // Feed the CSS grid-line gradients (project-gantt.css) the active
            // resolution's cell size so the body grid aligns with the header at
            // any DPR. Must match the <Gantt> cellWidth/cellHeight props below.
            style={
              {
                "--gantt-cell-width": `${CELL_WIDTH[viewMode]}px`,
                "--gantt-cell-height": "36px",
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              gestureRef.current = { x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              const g = gestureRef.current;
              if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleChartClick}
          >
            {scheduledTasks.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
                No scheduled tasks yet. Drag a task from the Unscheduled pool
                onto the timeline to schedule it.
              </div>
            ) : (
              // Reserve the full height while SVAR lays out (blank, matching
              // final dimensions — no skeleton), then fade the finished chart in.
              <div className={`h-full ${ready ? "animate-fade-in" : "opacity-0"}`}>
                <Theme>
                  <Gantt
                    init={init}
                    tasks={tasks}
                    links={links}
                    columns={GRID_COLUMNS}
                    gridWidth={GRID_WIDTH}
                    // Mobile: collapse the task-name grid so the timeline fills width
                    displayMode={isMobile ? "chart" : "all"}
                    scales={scales}
                    start={start}
                    end={end}
                    cellWidth={CELL_WIDTH[viewMode]}
                    cellHeight={36}
                    scaleHeight={36}
                  />
                </Theme>
              </div>
            )}
          </div>
        </CalendarSidebarInset>

        {/* Unscheduled pool — desktop right sidebar (pushes the chart), exactly
            like the calendar. On mobile it's hidden; tapping an empty timeline
            slot opens the date picker (handleChartClick) instead. */}
        <CalendarSidebar side="right" className="hidden md:flex">
          <CalendarSidebarHeader>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Unscheduled
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {unscheduledTasks.length}
              </span>
            </div>
          </CalendarSidebarHeader>
          <CalendarSidebarContent className="flex-1 min-h-0 overflow-y-auto">
            {poolList}
          </CalendarSidebarContent>
        </CalendarSidebar>
      </CalendarSidebarProvider>

      {/* Drag ghost — follows the cursor over the chart while dropping an
          unscheduled task, previewing the target date. */}
      {dragGhost && ghostTask && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: dragGhost.x + 14, top: dragGhost.y + 14 }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_COLORS[ghostTask.priority] ?? "#6b7280" }}
          />
          <span className="max-w-50 truncate font-medium text-foreground">{ghostTask.title}</span>
          {dragGhost.date && (
            <span className="shrink-0 text-muted-foreground">{formatDayTitle(dragGhost.date)}</span>
          )}
        </div>
      )}

      {/* Single-click action menu — same items as the calendar's event menu,
          anchored at the click position. Portalled to the body and dismissed by
          our own outside-press/Escape handling (see the effect above), so SVAR
          moving focus to the selected bar can't auto-close it. */}
      {menu && taskMenu &&
        createPortal(
          <div
            ref={menuElRef}
            role="menu"
            className="fixed z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { taskMenu.onNavigate(menu.taskId); setMenu(null); }}
            >
              View task details
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { taskMenu.onUnschedule(menu.taskId); setMenu(null); }}
            >
              Unschedule
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
