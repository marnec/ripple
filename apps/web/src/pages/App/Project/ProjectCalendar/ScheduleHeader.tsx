import type { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { Temporal } from "temporal-polyfill";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  GanttChartSquare,
  ListTodo,
  PanelRightClose,
  PanelRightOpen,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ScheduleView = "calendar" | "gantt";
export type GanttViewMode = "Day" | "Week" | "Month";

const GANTT_MODES: GanttViewMode[] = ["Day", "Week", "Month"];

export function ScheduleHeader({
  view,
  onViewChange,
  // Calendar nav
  calendarControls,
  // gantt
  ganttViewMode,
  onGanttViewModeChange,
  onGanttToday,
  onGanttPrev,
  onGanttNext,
  // shared
  commitmentMode,
  onCommitmentModeChange,
  unscheduledCount,
  poolOpen,
  onPoolToggle,
}: {
  view: ScheduleView;
  onViewChange: (v: ScheduleView) => void;
  calendarControls: ReturnType<typeof createCalendarControlsPlugin>;
  ganttViewMode: GanttViewMode;
  onGanttViewModeChange: (m: GanttViewMode) => void;
  onGanttToday: () => void;
  onGanttPrev: () => void;
  onGanttNext: () => void;
  commitmentMode: boolean;
  onCommitmentModeChange: (value: boolean) => void;
  unscheduledCount: number;
  poolOpen: boolean;
  onPoolToggle: () => void;
}) {
  // Long label on sm+, short ("Jun 2026") on mobile to keep the header one line.
  const [monthLabelLong, monthLabelShort] = (() => {
    try {
      const d = calendarControls.getDate();
      if (!d) return ["", ""];
      return [
        d.toLocaleString("en-US", { month: "long", year: "numeric" }),
        d.toLocaleString("en-US", { month: "short", year: "numeric" }),
      ];
    } catch {
      return ["", ""];
    }
  })();

  return (
    <div className="flex flex-wrap items-center justify-between w-full gap-x-2 gap-y-2 py-2">
      {/* Left: view selector + view-specific navigation */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {/* View selector — mirrors the Board/List tab style on the Tasks page */}
        <Tabs value={view} onValueChange={(v) => onViewChange(v as ScheduleView)}>
          <TabsList className="h-8">
            <TabsTrigger value="calendar" className="flex items-center gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Calendar</span>
            </TabsTrigger>
            <TabsTrigger value="gantt" className="flex items-center gap-1.5 text-xs">
              <GanttChartSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Gantt</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "calendar" ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const d = calendarControls.getDate();
                calendarControls.setDate(d.subtract({ months: 1 }));
              }}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const d = calendarControls.getDate();
                calendarControls.setDate(d.add({ months: 1 }));
              }}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums sm:min-w-30">
              <span className="sm:hidden">{monthLabelShort}</span>
              <span className="hidden sm:inline">{monthLabelLong}</span>
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
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onGanttPrev}
              aria-label="Scroll back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onGanttNext}
              aria-label="Scroll forward"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {/* Gantt resolution selector */}
            <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
              {GANTT_MODES.map((mode) => (
                <button
                  key={mode}
                  className={`px-2 py-1 rounded transition-colors ${
                    ganttViewMode === mode
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => onGanttViewModeChange(mode)}
                  aria-label={mode}
                >
                  {/* Abbreviate to D/W/M on mobile to save header width */}
                  <span className="sm:hidden">{mode[0]}</span>
                  <span className="hidden sm:inline">{mode}</span>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={onGanttToday}
              aria-label="Today"
            >
              <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Today</span>
            </Button>
          </div>
        )}
      </div>

      {/* Right: Planned/Commitment toggle + unscheduled pool toggle (shared) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border p-0.5 text-xs font-medium">
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              !commitmentMode
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onCommitmentModeChange(false)}
            aria-label="Planned"
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Planned</span>
          </button>
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
              commitmentMode
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onCommitmentModeChange(true)}
            aria-label="Commitment"
          >
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Commitment</span>
          </button>
        </div>

        {/* Unscheduled pool toggle. In calendar view this is desktop-only
            (mobile uses the day drawer); in gantt view the pool is the
            below-chart drawer, available on every breakpoint. */}
        {/* Desktop-only pool toggle. On mobile the unscheduled pool is reached
            by clicking an empty coordinate (calendar) / timeline slot (gantt). */}
        <Button
          variant="outline"
          size="sm"
          onClick={onPoolToggle}
          disabled={unscheduledCount === 0 && !poolOpen}
          className="h-7 text-xs hidden md:flex"
        >
          {poolOpen ? (
            <PanelRightClose className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <PanelRightOpen className="h-3.5 w-3.5 mr-1.5" />
          )}
          <ListTodo className="h-3.5 w-3.5 mr-1" />
          Unscheduled {unscheduledCount > 0 && `(${unscheduledCount})`}
        </Button>
      </div>
    </div>
  );
}
