import { useEffect, useMemo, useRef, useState } from "react";
import type { IApi } from "@svar-ui/react-gantt";
import { Temporal } from "temporal-polyfill";
import {
  type GanttResolution,
  svarCellWidth,
  taskSpan,
  computeRange,
  pageScrollPlan,
  isCellWidthStretched,
  isoToJsDate,
} from "./ganttTimeline";
import type { EnrichedTask } from "./calendar-events";

// Imperative handle the shared header uses to drive navigation.
export type GanttApi = {
  scrollToday: () => void;
  prev: () => void;
  next: () => void;
};

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

/**
 * Owns the imperative contract that keeps SVAR's integer column geometry stable
 * across range/resolution/resize, plus header-driven navigation. The pure
 * decisions live in ganttTimeline; this hook reads SVAR/DOM state, feeds them
 * in, and executes the returned plans. The caller is the thin shell that wires
 * the chart's data props and domain listeners.
 *
 * Returns the props the chart needs (`start`/`end`/`cellWidth`/`ready`), the
 * `onInit` to run inside `<Gantt init>`, and `svarApiRef` for the shell's own
 * DOM reads (e.g. drop-date snapping).
 */
export function useStableSvarGantt({
  containerRef,
  apiRef,
  scheduledTasks,
  previewTaskId,
  multiplier,
  resolution,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  apiRef: React.RefObject<GanttApi | null>;
  scheduledTasks: EnrichedTask[];
  previewTaskId?: string | null;
  multiplier: 1 | 5;
  resolution: GanttResolution;
}) {
  const svarApiRef = useRef<IApi | null>(null);

  // Keep the chart hidden until SVAR has finished its first layout + scroll
  // pass, then fade it in. Avoids showing the progressive render and the
  // scroll-to-range jump (the "layout shift" on mount).
  const [ready, setReady] = useState(false);

  // Container width, tracked so we can keep the date range at least as wide as
  // the chart area (computeRange's fill: prevents SVAR's fractional cellWidth
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
  }, [containerRef]);

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
  const span = taskSpan(rangeTasks, multiplier);
  const rangeSig = span ? `${span.minISO}|${span.maxISO}` : "empty";
  const { start, end } = useMemo(() => {
    const { startISO, endISO } = computeRange(span, {
      todayISO: Temporal.Now.plainDateISO().toString(),
      resolution,
      containerWidth,
      panDays,
    });
    return { start: isoToJsDate(startISO), end: isoToJsDate(endISO) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSig, containerWidth, resolution, panDays]);

  // The cellWidth prop SVAR receives — a *day* width in Week view (see
  // ganttTimeline) — plus the sub-pixel parity nudge that forces a re-apply.
  const cellWidth = svarCellWidth(resolution) + (cellWidthNudge % 2) * 1e-6;

  // Capture SVAR's api and reveal once the chart has been laid out and painted.
  // A double rAF waits one frame past SVAR's initial render/scroll so the
  // fade-in shows the finished chart, not its intermediate states. Run inside
  // `<Gantt init>` (SVAR calls init exactly once).
  const onInit = (svarApi: IApi) => {
    svarApiRef.current = svarApi;
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
      const state = svarApi.getState() as {
        scrollLeft?: number;
        _scales?: { width?: number };
        _chartWidth?: number;
      };
      const plan = pageScrollPlan(
        {
          scrollLeft: state.scrollLeft ?? 0,
          scalesWidth: state._scales?.width ?? 0,
          chartWidth: state._chartWidth ?? 0,
        },
        dir,
        resolution,
      );
      if (plan.kind === "within") {
        // Within range → just animate the page.
        scrollChartTo(containerRef.current, plan.left, svarApi);
      } else {
        // Past an edge → grow that side of the range, then defer the scroll
        // (pendingScrollRef + effect below) until the new range commits. anchor
        // snaps the view stable across the growth; target animates one page over.
        setPanDays((p) =>
          plan.side === "past"
            ? { ...p, past: p.past + plan.pageDays }
            : { ...p, future: p.future + plan.pageDays },
        );
        pendingScrollRef.current = { anchor: plan.anchor, target: plan.target };
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
  }, [apiRef, containerRef, resolution]);

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
  }, [start, end, containerRef]);

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
        if (actual != null && isCellWidthStretched(actual, resolution)) {
          setCellWidthNudge((n) => n + 1);
        }
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [start, end, resolution, containerWidth]);

  return { svarApiRef, start, end, cellWidth, ready, onInit };
}
