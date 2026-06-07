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
import { type EnrichedTask } from "./calendar-events";
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

// Visible column pixel width per resolution (one week column = 80px, etc).
const CELL_WIDTH: Record<GanttViewMode, number> = { Day: 42, Week: 80, Month: 120 };

// SVAR's lowest scale unit drives ALL of its geometry, so to keep month banners
// aligned to days (not snapped to whole weeks — months don't tile weeks, which
// made the upper row overlap + flex-shrink and drift), the Week view's lowest
// unit is `day` (rendered every 7 days, see scalesFor). That makes SVAR's
// `cellWidth` a *day* width, so the visible column = `cellWidth × unitsPerColumn`.
// We hand SVAR `CELL_WIDTH / unitsPerColumn`; everything else here (pan, fill,
// body-grid gradient) keeps using CELL_WIDTH, the visible column width.
const UNITS_PER_COLUMN: Record<GanttViewMode, number> = { Day: 1, Week: 7, Month: 1 };
const svarCellWidth = (mode: GanttViewMode) => CELL_WIDTH[mode] / UNITS_PER_COLUMN[mode];

// Approx days per column, per resolution — used to translate a page of columns
// into the date-range extension that lets prev/next pan past the task span.
// (Month is variable; 31 is close enough for paging.)
const UNIT_DAYS: Record<GanttViewMode, number> = { Day: 1, Week: 7, Month: 31 };

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
    // Lower row is `day` with step 7 (not `week`) so SVAR's lowest unit is the
    // day: month cells are then sized in exact days and land on their true
    // calendar boundaries (mid-column), instead of being snapped to whole weeks.
    // step 7 still renders one cell per week; start is week-aligned (see memo) so
    // those cells are calendar weeks.
    return [
      { unit: "month" as const, step: 1, format: "%F %Y" },
      { unit: "day" as const, step: 7, format: "%d %M" },
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

// Escape a task id for safe use inside a `[data-id="…"]` attribute selector.
// Convex ids are already selector-safe, but CSS.escape guards against any future
// id shape (and keeps the rule from silently breaking on an exotic character).
function cssEscapeId(id: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
}

// SVAR's horizontal scroller. It keeps the sticky timeline header in sync from
// this element's native `scroll` event, so animating its scrollLeft directly
// (smooth) pans header + body together — no need to tween via SVAR's state.
function getChartScroller(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>(".wx-chart") ?? null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// Scroll the chart to a pixel offset, animated unless reduced-motion is set.
// Falls back to SVAR's exec if the DOM scroller isn't found.
function scrollChartTo(container: HTMLElement | null, left: number, svarApi: IApi | null) {
  const clamped = Math.max(0, left);
  const chart = getChartScroller(container);
  if (chart) {
    chart.scrollTo({ left: clamped, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  } else {
    void svarApi?.exec("scroll-chart", { left: clamped });
  }
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
  previewTaskId,
  onPreviewChange,
  onSchedule,
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
  /** Id of the task currently shown as a tentative (dashed) drag preview bar. */
  previewTaskId?: string | null;
  /** Report the tentative drop position upward so the parent can splice the
   *  previewed task into the list (drives the in-grid preview bar). */
  onPreviewChange?: (preview: { taskId: string; date: string } | null) => void;
  /** Commit a pool drop. The parent persists it with an optimistic hold so the
   *  bar stays on screen (solid) until Convex round-trips. */
  onSchedule?: (taskId: string, date: string) => void;
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
  //
  // Seeded with the window width (not 0): SVAR's *first* layout runs before the
  // ResizeObserver fires, so a 0 seed would yield a too-narrow range and let SVAR
  // stretch cellWidth on that first pass. That stretch is permanent — SVAR's
  // `init()` only re-applies props that changed, and the cellWidth prop stays 80,
  // so a fractional state.cellWidth is never reset (it just shifts on each
  // resize-grid, which is the sidebar-dependent month/week misalignment). The
  // window is always ≥ the chart area, so seeding it guarantees no first-pass
  // stretch; the observer then refines to the real (smaller-or-equal) width.
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tiny parity nudge added to the cellWidth prop to force SVAR to re-apply it.
  // A stretch is permanent (init() skips unchanged props), so if one ever slips
  // through (e.g. a window-grow transient outpacing the fill), flipping this
  // changes the prop value enough to re-apply the correct width. The nudge is
  // ~1e-6px/day — utterly sub-pixel — so it never affects alignment itself.
  const [cellWidthNudge, setCellWidthNudge] = useState(0);

  // Manual pan extension (in days) added on top of the task-derived range so the
  // prev/next arrows can scroll into empty time indefinitely — SVAR clamps
  // scrolling to the content bounds, so reaching further means growing the range
  // itself. Grown a page at a time by scrollByPage when it hits an edge.
  const [panDays, setPanDays] = useState({ past: 0, future: 0 });
  // Scroll move to apply once a pan-driven range growth has been committed (set
  // by scrollByPage, consumed by the effect below after start/end update).
  // `anchor` is snapped instantly to keep the view visually stable across the
  // range growth; then we animate to `target` (one page over).
  const pendingScrollRef = useRef<{ anchor: number; target: number } | null>(null);

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
  //
  // The in-flight drag preview is excluded: its date chases the cursor every
  // column, so letting it drive the range would re-pad and re-layout the
  // timeline mid-drag (most visible on an otherwise-empty chart, where the
  // preview is the *only* task and the range would jump with it). The preview
  // date is always within the already-rendered range anyway (it's derived from
  // the live timeline), so the bar still shows. A committed/optimistic task
  // (previewTaskId cleared) does drive the range, as it should.
  const rangeTasks = previewTaskId
    ? scheduledTasks.filter((t) => t._id !== previewTaskId)
    : scheduledTasks;
  const rangeSig = (() => {
    if (rangeTasks.length === 0) return "empty";
    let min = rangeTasks[0].plannedStartDate!;
    let max = min;
    for (const t of rangeTasks) {
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
    for (const t of rangeTasks) {
      const s = t.plannedStartDate!;
      const e = addCalendarDays(s, estimateToDays(t.estimate, multiplier));
      if (s < min) min = s;
      if (e > max) max = e;
    }
    // Base padding around the tasks, plus any manual pan extension the arrows
    // have accumulated (lets prev/next roam past the task span — see above).
    let startISO = addCalendarDays(min, -14 - panDays.past);
    // Week view's lower row is day/step-7; align start to the week start (Sunday)
    // so those 7-day cells are calendar weeks, not start-relative buckets.
    if (viewMode === "Week") {
      startISO = addCalendarDays(startISO, -isoToJsDate(startISO).getDay());
    }
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
    if (containerWidth > 0) {
      const minCols = Math.ceil(containerWidth / cellWidth) + 2;
      const fillEndISO = addCalendarDays(startISO, minCols * UNIT_DAYS[viewMode]);
      if (fillEndISO > endISO) endISO = fillEndISO;
    }
    // Future pan extension goes on top of whatever the fill required, so each
    // next() reliably grows the range even when the viewport-fill dominates.
    endISO = addCalendarDays(endISO, panDays.future);

    return { start: isoToJsDate(startISO), end: isoToJsDate(endISO) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSig, containerWidth, viewMode, panDays]);

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
    // Page the chart by one page of columns. SVAR clamps scrolling to the
    // content bounds, so when a page would land outside the current range we
    // first grow the range by a page on that side (via panDays) and defer the
    // scroll until the new range is committed (pendingScrollRef + effect below).
    const scrollByPage = (dir: -1 | 1) => {
      const svarApi = svarApiRef.current;
      if (!svarApi) return;
      const cw = CELL_WIDTH[viewMode];
      const pageCols = PAGE_COLUMNS[viewMode];
      const pageWidth = cw * pageCols;
      const pageDays = pageCols * UNIT_DAYS[viewMode];
      const state = svarApi.getState() as {
        scrollLeft?: number;
        _scales?: { width?: number };
        _chartWidth?: number;
      };
      const scrollLeft = state.scrollLeft ?? 0;
      const maxScroll = Math.max(0, (state._scales?.width ?? 0) - (state._chartWidth ?? 0));
      const target = scrollLeft + dir * pageWidth;

      if (dir < 0 && target < 0) {
        // Past the left edge → grow the past side. Content shifts right by one
        // page, so the current view will sit at scrollLeft + pageWidth in the
        // new range (anchor); animate from there back one page to scrollLeft.
        setPanDays((p) => ({ ...p, past: p.past + pageDays }));
        pendingScrollRef.current = { anchor: scrollLeft + pageWidth, target: scrollLeft };
      } else if (dir > 0 && target > maxScroll) {
        // Past the right edge → grow the future side (added on the right only,
        // so the view stays put; animate forward one page to target).
        setPanDays((p) => ({ ...p, future: p.future + pageDays }));
        pendingScrollRef.current = { anchor: scrollLeft, target };
      } else {
        // Within range → just animate the page.
        scrollChartTo(containerRef.current, Math.min(target, maxScroll), svarApi);
      }
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

  // After a pan-driven range growth commits (start/end change), apply the scroll
  // move scrollByPage stashed — deferred so SVAR has laid out the new range.
  // The anchor MUST go through SVAR's `scroll-chart` exec, not a raw DOM scroll:
  // a range change resets SVAR's internal scrollLeft to 0 and it force-syncs the
  // DOM back to that, so a direct chart.scrollTo() gets clobbered (it wormholed
  // to the range start). exec makes SVAR's state authoritative at the anchor;
  // the subsequent native smooth scroll is then safe (no further range change,
  // so onScroll keeps state in sync — same as the within-range path).
  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const svarApi = svarApiRef.current;
        if (!svarApi) return;
        void svarApi.exec("scroll-chart", { left: Math.max(0, pending.anchor) });
        requestAnimationFrame(() => {
          scrollChartTo(containerRef.current, pending.target, svarApiRef.current);
        });
      }),
    );
  }, [start, end]);

  // Stability guard: if SVAR ever stretches cellWidth (a fractional value it then
  // never resets, which desyncs the 80px-period body grid from the week cells),
  // detect the divergence after layout and flip cellWidthNudge to force a
  // re-apply of the correct width. Runs after the changes that can trigger a
  // stretch (range/resolution/container). The fill normally prevents stretches
  // entirely; this is the backstop that makes the fractional cellWidth durable.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const api = svarApiRef.current;
        if (!api) return;
        const actual = (api.getState() as { cellWidth?: number }).cellWidth;
        const expected = svarCellWidth(viewMode);
        if (actual != null && Math.abs(actual - expected) / expected > 0.01) {
          setCellWidthNudge((n) => n + 1);
        }
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [start, end, viewMode, containerWidth]);

  // Snap a cursor X to the chart's unit grid → the date a drop lands on.
  // `originLeft` is the viewport x of timeline content-x 0. Prefer `.wx-bars`
  // (its rect already folds in the left task-name grid width AND the horizontal
  // scroll — a single source of truth). Fall back to the `.wx-chart` scroller
  // (origin = its left minus scrollLeft) for the empty chart, where SVAR may not
  // mount a bars layer until there's a task.
  function dateFromDropX(clientX: number): string | null {
    const svarApi = svarApiRef.current;
    if (!svarApi) return null;
    const scaleState = (svarApi.getState() as { _scales?: { start: Date; lengthUnitWidth: number; lengthUnit: string } })._scales;
    if (!scaleState?.lengthUnitWidth) return null;
    const container = containerRef.current;
    const bars = container?.querySelector<HTMLElement>(".wx-bars");
    const chart = container?.querySelector<HTMLElement>(".wx-chart");
    let originLeft: number;
    if (bars) {
      originLeft = bars.getBoundingClientRect().left;
    } else if (chart) {
      originLeft = chart.getBoundingClientRect().left - chart.scrollLeft;
    } else {
      return null;
    }
    const units = Math.floor(Math.max(0, clientX - originLeft) / scaleState.lengthUnitWidth);
    const unit = scaleState.lengthUnit;
    const unitDays = unit === "week" ? 7 : unit === "month" ? 30 : 1;
    return addCalendarDays(jsDateToISO(scaleState.start), units * unitDays);
  }

  // Tentative scheduling preview. Rather than draw a floating element at the
  // cursor, we report the dragged task + snapped date upward; the parent splices
  // it into the task list at its real position, so SVAR renders the preview bar
  // in the *exact* row the committed task will occupy (its row is fixed by task
  // order, not by where the cursor is — and may fall between two existing rows).
  // We only emit when the snapped date actually changes, so the parent re-renders
  // at most once per column crossing, not per mousemove.
  const lastPreviewRef = useRef<{ taskId: string; date: string } | null>(null);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const taskId = calendarDragContext.currentTaskId;
    if (!taskId) return;
    const date = dateFromDropX(e.clientX);
    if (!date) return;
    const last = lastPreviewRef.current;
    if (last?.taskId === taskId && last.date === date) return;
    lastPreviewRef.current = { taskId, date };
    onPreviewChange?.({ taskId, date });
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      lastPreviewRef.current = null;
      onPreviewChange?.(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    lastPreviewRef.current = null;
    const taskId = e.dataTransfer.getData("task-id");
    calendarDragContext.clearDragTask();
    const date = taskId ? dateFromDropX(e.clientX) : null;
    // Hand off to the parent's optimistic commit: it clears the dashed drag
    // preview and holds a solid bar (via pendingSchedule) through the round-trip,
    // so the bar never flashes out between drop and the Convex update.
    onPreviewChange?.(null);
    if (taskId && date) onSchedule?.(taskId, date);
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
            className="ripple-gantt relative flex-1 min-h-0 overflow-hidden"
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
            {/* Always render the chart — even with zero tasks — so there's a
                live timeline to map a drop against. Without it, the first task
                could never be scheduled by drag (no `.wx-bars`/`_scales` to read
                a date from). Reserve the full height while SVAR lays out (blank,
                matching final dimensions — no skeleton), then fade it in. */}
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
                  cellWidth={svarCellWidth(viewMode) + (cellWidthNudge % 2) * 1e-6}
                  cellHeight={36}
                  scaleHeight={36}
                />
              </Theme>
            </div>

            {/* Empty hint, overlaid on the (empty) timeline. `pointer-events-none`
                so drags still reach the chart underneath. Hidden the moment a
                drag preview or a scheduled task populates the grid. */}
            {scheduledTasks.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <span className="max-w-xs rounded-md bg-background/70 px-3 py-2 backdrop-blur-sm">
                  No scheduled tasks yet. Drag a task from the Unscheduled pool
                  onto the timeline to schedule it.
                </span>
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

      {/* Tentative drag preview. The previewed task is spliced into the task
          list by the parent, so SVAR renders a real bar in the correct row;
          this only restyles that one bar as dashed + translucent to mark it as
          not-yet-committed. Targeting `data-id` (SVAR stamps it with the task
          id) scopes the rule to exactly the preview bar. */}
      {previewTaskId && (
        <style>{`.ripple-gantt .wx-bar[data-id="${cssEscapeId(previewTaskId)}"]{opacity:.6;outline:2px dashed var(--wx-color-primary,#6366f1);outline-offset:-2px;}.ripple-gantt .wx-bar[data-id="${cssEscapeId(previewTaskId)}"] .wx-progress-percent{opacity:0;}`}</style>
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
