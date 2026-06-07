// Timeline geometry — the pure mapping between a task's ISO planned dates and
// the Gantt's pixel/column grid (see CONTEXT.md). This module imports no
// React/SVAR/DOM: its interface is the test surface (plain vitest, no jsdom).
// GanttView is the imperative shell that reads SVAR/DOM state and `today`, hands
// them in as plain values, and executes the plans returned here.
import { Temporal } from "temporal-polyfill";
import type { ITask } from "@svar-ui/react-gantt";
import { estimateToDays, addCalendarDays } from "@/lib/calendar-utils";
import type { EnrichedTask } from "./calendar-events";

export type GanttResolution = "Day" | "Week" | "Month";

export type GanttDependency = {
  edgeId: string;
  sourceId: string;
  targetId: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Column resolution tables
// ─────────────────────────────────────────────────────────────────────────────

// How far prev/next pages, in columns, per resolution (one column = one unit
// of the active view mode).
const PAGE_COLUMNS: Record<GanttResolution, number> = { Day: 7, Week: 4, Month: 3 };

// Visible column pixel width per resolution (one week column = 80px, etc).
const CELL_WIDTH: Record<GanttResolution, number> = { Day: 42, Week: 80, Month: 120 };

// SVAR's lowest scale unit drives ALL of its geometry, so to keep month banners
// aligned to days (not snapped to whole weeks — months don't tile weeks, which
// made the upper row overlap + flex-shrink and drift), the Week view's lowest
// unit is `day` (rendered every 7 days, see scalesFor). That makes SVAR's
// `cellWidth` a *day* width, so the visible column = `cellWidth × unitsPerColumn`.
// We hand SVAR `CELL_WIDTH / unitsPerColumn`; everything else (pan, fill,
// body-grid gradient) keeps using CELL_WIDTH, the visible column width.
const UNITS_PER_COLUMN: Record<GanttResolution, number> = { Day: 1, Week: 7, Month: 1 };

// Approx days per column, per resolution — used to translate a page of columns
// into the date-range extension that lets prev/next pan past the task span.
// (Month is variable; 31 is close enough for paging.)
const UNIT_DAYS: Record<GanttResolution, number> = { Day: 1, Week: 7, Month: 31 };

/** The cellWidth prop SVAR receives (a *day* width in Week view — see above). */
export function svarCellWidth(resolution: GanttResolution): number {
  return CELL_WIDTH[resolution] / UNITS_PER_COLUMN[resolution];
}

/** The visible column width in px — feeds the CSS body-grid gradient. */
export function columnWidthPx(resolution: GanttResolution): number {
  return CELL_WIDTH[resolution];
}

// Scale rows per resolution. The lowest row's unit drives bar granularity.
export function scalesFor(resolution: GanttResolution) {
  if (resolution === "Day")
    return [
      { unit: "month" as const, step: 1, format: "%F %Y" },
      { unit: "day" as const, step: 1, format: "%j" },
    ];
  if (resolution === "Week")
    // Lower row is `day` with step 7 (not `week`) so SVAR's lowest unit is the
    // day: month cells are then sized in exact days and land on their true
    // calendar boundaries (mid-column), instead of being snapped to whole weeks.
    // step 7 still renders one cell per week; start is week-aligned (see
    // computeRange) so those cells are calendar weeks.
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
// ISO ⇄ JS Date boundary — the one place the module touches JS Date (SVAR wants
// Date objects). Local-midnight interpretation, matching the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────

export function jsDateToISO(d: Date): string {
  return Temporal.PlainDate.from({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  }).toString();
}

export function isoToJsDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// SVAR data builders
// ─────────────────────────────────────────────────────────────────────────────

export function buildSvarTasks(scheduled: EnrichedTask[], multiplier: 1 | 5): ITask[] {
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

export function buildSvarLinks(deps: GanttDependency[]) {
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
// Range — padding/fill around the task span (and today)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ISO span of the scheduled tasks — earliest start to latest end (start +
 * estimateToDays). `null` when there are no tasks. Excludes `today`; the caller
 * folds that in via computeRange so the range always contains today.
 */
export function taskSpan(
  tasks: EnrichedTask[],
  multiplier: 1 | 5,
): { minISO: string; maxISO: string } | null {
  if (tasks.length === 0) return null;
  let minISO = tasks[0].plannedStartDate!;
  let maxISO = minISO;
  for (const t of tasks) {
    const s = t.plannedStartDate!;
    const e = addCalendarDays(s, estimateToDays(t.estimate, multiplier));
    if (s < minISO) minISO = s;
    if (e > maxISO) maxISO = e;
  }
  return { minISO, maxISO };
}

/**
 * The chart date range — padded around the task span and today so there's room
 * to scroll. `today` always sits inside the result.
 *
 * The fill (containerWidth) prevents SVAR auto-stretching cellWidth to a
 * *fractional*, viewport-dependent value when the range is narrower than the
 * chart area (its `qs()`: `if (u < e) cellWidth = cellWidth * (e / u)`). A
 * fractional column width can't be matched by the DOM header cells or our CSS
 * grid lines, so they'd drift — and the drift would shift as the built-in grid
 * splitter resizes. Extending the range so its pixel width meets-or-exceeds the
 * container keeps SVAR on the integer cellWidth we set. `containerWidth === 0`
 * (SSR seed, before the ResizeObserver fires) skips the fill.
 *
 * `panDays` is the manual extension the prev/next arrows accumulate so they can
 * roam past the task span (SVAR clamps scrolling to the content bounds).
 */
export function computeRange(
  span: { minISO: string; maxISO: string } | null,
  opts: {
    todayISO: string;
    resolution: GanttResolution;
    containerWidth: number;
    panDays: { past: number; future: number };
  },
): { startISO: string; endISO: string } {
  const { todayISO, resolution, containerWidth, panDays } = opts;
  const min = span && span.minISO < todayISO ? span.minISO : todayISO;
  const max = span && span.maxISO > todayISO ? span.maxISO : todayISO;

  let startISO = addCalendarDays(min, -14 - panDays.past);
  // Week view's lower row is day/step-7; align start to the week start (Sunday)
  // so those 7-day cells are calendar weeks, not start-relative buckets.
  // Temporal's dayOfWeek is ISO (Mon=1…Sun=7); `% 7` gives Sun=0…Sat=6.
  if (resolution === "Week") {
    startISO = addCalendarDays(startISO, -(Temporal.PlainDate.from(startISO).dayOfWeek % 7));
  }
  let endISO = addCalendarDays(max, 30);

  const cellWidth = CELL_WIDTH[resolution];
  if (containerWidth > 0) {
    const minCols = Math.ceil(containerWidth / cellWidth) + 2;
    const fillEndISO = addCalendarDays(startISO, minCols * UNIT_DAYS[resolution]);
    if (fillEndISO > endISO) endISO = fillEndISO;
  }
  // Future pan extension goes on top of whatever the fill required, so each
  // next() reliably grows the range even when the viewport-fill dominates.
  endISO = addCalendarDays(endISO, panDays.future);

  return { startISO, endISO };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop-date snapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snap a cursor X to the chart's unit grid → the ISO date a drop lands on.
 * `originLeft` is the viewport x of timeline content-x 0; the shell resolves it
 * from the DOM. `scale` mirrors SVAR's `_scales` (its reported lowest unit).
 */
export function dateFromOffset(
  clientX: number,
  originLeft: number,
  scale: { startISO: string; lengthUnitWidth: number; lengthUnit: string },
): string {
  const units = Math.floor(Math.max(0, clientX - originLeft) / scale.lengthUnitWidth);
  // SVAR's reported unit, mapped to days. Month here is SVAR's own estimate (30),
  // distinct from UNIT_DAYS' paging estimate (31) — different jobs, kept apart.
  const unitDays = scale.lengthUnit === "week" ? 7 : scale.lengthUnit === "month" ? 30 : 1;
  return addCalendarDays(scale.startISO, units * unitDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paging
// ─────────────────────────────────────────────────────────────────────────────

export type PageScrollPlan =
  | { kind: "within"; left: number }
  | { kind: "grow"; side: "past" | "future"; pageDays: number; anchor: number; target: number };

/**
 * Decide how to page the chart by one page of columns in `dir`. SVAR clamps
 * scrolling to the content bounds, so when a page would land outside the range
 * the plan grows that side (`grow`) and reports the scroll move to apply once
 * the range has committed; otherwise it's a plain in-range scroll (`within`).
 *
 * `grow.anchor` is snapped instantly to keep the view visually stable across the
 * range growth; the shell then animates to `grow.target` (one page over).
 *  - past: content shifts right by a page, so the current view sits at
 *    scrollLeft + pageWidth in the new range (anchor); animate back to scrollLeft.
 *  - future: added on the right only, so the view stays put (anchor = scrollLeft);
 *    animate forward to target.
 */
export function pageScrollPlan(
  view: { scrollLeft: number; scalesWidth: number; chartWidth: number },
  dir: -1 | 1,
  resolution: GanttResolution,
): PageScrollPlan {
  const pageCols = PAGE_COLUMNS[resolution];
  const pageWidth = CELL_WIDTH[resolution] * pageCols;
  const pageDays = pageCols * UNIT_DAYS[resolution];
  const maxScroll = Math.max(0, view.scalesWidth - view.chartWidth);
  const target = view.scrollLeft + dir * pageWidth;

  if (dir < 0 && target < 0) {
    return { kind: "grow", side: "past", pageDays, anchor: view.scrollLeft + pageWidth, target: view.scrollLeft };
  }
  if (dir > 0 && target > maxScroll) {
    return { kind: "grow", side: "future", pageDays, anchor: view.scrollLeft, target };
  }
  return { kind: "within", left: Math.min(target, maxScroll) };
}

/**
 * True when SVAR has stretched cellWidth away from the integer value we set
 * (a fractional value it never resets, desyncing the body grid from the cells).
 * The fill normally prevents stretches; this backstop detects a slip so the
 * shell can force a re-apply. Threshold is 1% of the expected width.
 */
export function isCellWidthStretched(actual: number, resolution: GanttResolution): boolean {
  const expected = svarCellWidth(resolution);
  return Math.abs(actual - expected) / expected > 0.01;
}
