import { UserAvatar } from "@/components/UserAvatar";
import { TaskCode } from "@/components/TaskCode";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { formatDueDate, getPriorityIcon } from "@/lib/task-utils";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import {
  ArrowRight,
  Ban,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Hourglass,
  Inbox,
  RefreshCw,
  UserRoundX,
} from "lucide-react";
import React, { Suspense, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatDateRange } from "./cycleUtils";
import { taskViewSearch } from "./taskViewParams";
import {
  DAY_MS,
  attentionSignals,
  computeBurnup,
  inProgressSince,
  statusMix,
  workload,
  type Burnup,
  type OverviewTask,
  type Signal,
  type SignalKey,
} from "./projectOverviewModel";
import { useTaskSheetParam } from "./taskSheetParam";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);

type Cycle = NonNullable<ReturnType<typeof useQuery<typeof api.cycles.listByProject>>>[number];
type Status = NonNullable<ReturnType<typeof useQuery<typeof api.taskStatuses.listByProject>>>[number];

/**
 * The project at a glance: where work is in the pipeline (backlog → current
 * cycle → what's next), how the current cycle is tracking, and the few tasks
 * that need someone to act. Everything else is one click deeper.
 */
export function ProjectOverview() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return <ProjectOverviewContent workspaceId={workspaceId} projectId={projectId} />;
}

function ProjectOverviewContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const project = useQuery(api.projects.get, { id: projectId });
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const backlog = useQuery(api.cycles.backlogSize, { projectId });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const current = cycles?.find((c) => c.isCurrent);
  const tasks = useQuery(
    api.cycles.listCycleTasks,
    current ? { cycleId: current._id } : "skip",
  );
  // In the URL (`?task=`), so the task page can send you back here.
  const [selectedTaskId, setSelectedTaskId] = useTaskSheetParam();
  // Pinned at mount: the overview is a snapshot of "today", and a clock that
  // ticks every render would re-derive the chart on each keystroke elsewhere.
  const [now] = useState(() => Date.now());

  const ready =
    project !== undefined &&
    cycles !== undefined &&
    backlog !== undefined &&
    statuses !== undefined &&
    (current === undefined || tasks !== undefined);
  if (!ready) return null;

  const openTask = (taskId: Id<"tasks">) => {
    if (isMobile) void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`);
    else setSelectedTaskId(taskId);
  };

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8 space-y-6">
        {project?.description && (
          <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        )}

        <Pipeline cycles={cycles} backlogOpen={backlog?.open ?? 0} />

        {current && tasks ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <CurrentCycle cycle={current} tasks={tasks} statuses={statuses ?? []} now={now} />
            <div className="space-y-6">
              <NeedsAttention signals={attentionSignals(tasks, now)} now={now} onOpenTask={openTask} />
              <Workload tasks={tasks} />
            </div>
          </div>
        ) : (
          <NoCurrentCycle />
        )}
      </div>

      {!isMobile && (
        <Suspense fallback={null}>
          <LazyTaskDetailSheet
            taskId={selectedTaskId}
            open={selectedTaskId !== null}
            onOpenChange={(open) => {
              if (!open) setSelectedTaskId(null);
            }}
            workspaceId={workspaceId}
            projectId={projectId}
          />
        </Suspense>
      )}
    </div>
  );
}

// ── Pipeline ────────────────────────────────────────────────────────

/** Next open cycles shown in the pipeline before folding into "+N". */
const NEXT_SHOWN = 2;

/**
 * Where the project's work sits, left to right in the order it flows:
 * the backlog, the cycle being worked, and the open cycles queued after it.
 */
function Pipeline({ cycles, backlogOpen }: { cycles: Cycle[]; backlogOpen: number }) {
  const current = cycles.find((c) => c.isCurrent);
  const next = cycles
    .filter((c) => c.status === "open" && !c.isCurrent)
    .sort((a, b) => a._creationTime - b._creationTime);
  const shown = next.slice(0, NEXT_SHOWN);
  const hidden = next.length - shown.length;

  return (
    <nav aria-label="Project pipeline" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ol className="flex min-w-max items-stretch gap-1.5">
        <PipelineStage to="backlog" muted={backlogOpen === 0}>
          <Inbox className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Backlog</span>
          <span className="text-sm tabular-nums text-muted-foreground">{backlogOpen}</span>
        </PipelineStage>

        <PipelineArrow />

        {current ? (
          <PipelineStage to="tasks" highlight>
            <span className="max-w-48 truncate text-sm font-semibold">{current.name}</span>
            <MiniProgress value={current.progressPercent} />
            <span className="text-xs tabular-nums text-muted-foreground">
              {current.completedTasks}/{current.totalTasks}
            </span>
          </PipelineStage>
        ) : (
          <PipelineStage to="cycles" muted>
            <span className="text-sm text-muted-foreground">No current cycle</span>
          </PipelineStage>
        )}

        {shown.map((cycle) => (
          <React.Fragment key={cycle._id}>
            <PipelineArrow />
            <PipelineStage to={`cycles/${cycle._id}`}>
              <span className="max-w-40 truncate text-sm font-medium">{cycle.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {cycle.totalTasks} {cycle.totalTasks === 1 ? "task" : "tasks"}
              </span>
            </PipelineStage>
          </React.Fragment>
        ))}
        {hidden > 0 && (
          <PipelineStage to="cycles" muted>
            <span className="text-sm text-muted-foreground">+{hidden}</span>
          </PipelineStage>
        )}
      </ol>
    </nav>
  );
}

function PipelineStage({
  to,
  highlight,
  muted,
  children,
}: {
  to: string;
  highlight?: boolean;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex">
      <Link
        to={to}
        className={cn(
          "flex h-10 items-center gap-2 rounded-lg border px-3 transition-colors hover:bg-accent",
          highlight && "border-foreground/20 bg-accent/60",
          muted && "border-dashed",
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function PipelineArrow() {
  return (
    <li aria-hidden className="flex items-center text-muted-foreground/50">
      <ChevronRight className="size-4" />
    </li>
  );
}

function MiniProgress({ value }: { value: number }) {
  return (
    <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-foreground/70 transition-[width] duration-500"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

// ── Current cycle ───────────────────────────────────────────────────

function CurrentCycle({
  cycle,
  tasks,
  statuses,
  now,
}: {
  cycle: Cycle;
  tasks: OverviewTask[];
  statuses: Status[];
  now: number;
}) {
  const burnup = computeBurnup(tasks, cycle, now);
  const doneCount = burnup.series.at(-1)?.done ?? 0;
  const percent = burnup.total === 0 ? 0 : Math.round((doneCount / burnup.total) * 100);
  const dateRange = formatDateRange(cycle.startDate, cycle.dueDate);
  const daysLeft = burnup.target === null ? null : Math.round((burnup.target - burnup.today) / DAY_MS);

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Current cycle
          </p>
          <Link
            to={`cycles/${cycle._id}`}
            className="mt-0.5 block truncate text-lg font-semibold hover:underline underline-offset-4"
          >
            {cycle.name}
          </Link>
          {(dateRange || daysLeft !== null) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dateRange}
              {daysLeft !== null && (
                <span className={cn(dateRange && "ml-1.5", daysLeft < 0 && "text-destructive")}>
                  {dateRange && "· "}
                  {daysLeft > 0
                    ? `${daysLeft}d to target`
                    : daysLeft === 0
                      ? "target today"
                      : `${-daysLeft}d past target`}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums leading-none">
            {percent}
            <span className="text-lg text-muted-foreground">%</span>
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {doneCount} of {burnup.total} done
          </p>
        </div>
      </header>

      <div className="px-5 pt-3">
        <PaceLine burnup={burnup} />
      </div>

      {burnup.total > 0 ? (
        <>
          {/* A flat line says nothing the pace line doesn't; draw once there's a climb. */}
          {doneCount > 0 ? (
            <div className="px-2 pt-2 sm:px-5">
              <BurnupChart burnup={burnup} />
            </div>
          ) : (
            <div className="h-4" />
          )}
          <div className="mt-2 border-t px-5 py-4">
            <StatusMix tasks={tasks} statuses={statuses} />
          </div>
        </>
      ) : (
        <div className="px-5 pb-6 pt-4 text-sm text-muted-foreground">
          Nothing planned yet. Pull work in from the{" "}
          <Link to="backlog" className="underline underline-offset-2 hover:text-foreground">
            backlog
          </Link>
          .
        </div>
      )}
    </section>
  );
}

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** One sentence on where the cycle is heading at the pace so far. */
function PaceLine({ burnup }: { burnup: Burnup }) {
  const f = burnup.forecast;
  if (burnup.total === 0) return null;

  let warn = false;
  let text: ReactNode;
  if (f.kind === "complete") {
    text = "Everything here is done — ready to close.";
  } else if (f.kind === "unknown") {
    text = "Not enough finished yet to forecast a finish.";
  } else if (f.slipDays === null) {
    text = (
      <>
        At this pace, done around <strong className="font-medium text-foreground">{fmtDay(f.finish)}</strong>.
      </>
    );
  } else if (f.slipDays <= 0) {
    text = (
      <>
        On pace to finish <strong className="font-medium text-foreground">{fmtDay(f.finish)}</strong>
        {f.slipDays < 0 && <>, {-f.slipDays}d ahead of target</>}.
      </>
    );
  } else {
    warn = true;
    text = (
      <>
        At this pace, done <strong className="font-medium text-foreground">{fmtDay(f.finish)}</strong> —{" "}
        {f.slipDays}d past target.
      </>
    );
  }

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {warn && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
      <span>{text}</span>
    </p>
  );
}

// ── Burn-up chart ───────────────────────────────────────────────────

const CHART_W = 600;
const CHART_H = 150;
const PAD_TOP = 10;

/**
 * Completed work climbing toward the cycle's scope. The dotted diagonal is
 * the even pace to the target; the dashed tail extends the pace so far to
 * where it meets the scope. Labels live in HTML around the SVG so they don't
 * stretch with it.
 */
function BurnupChart({ burnup }: { burnup: Burnup }) {
  const { start, today, target, total, series, forecast } = burnup;
  const [hover, setHover] = useState<number | null>(null);

  // The axis runs to whichever is later, the target or today, plus one day so
  // today's point isn't pinned to the edge.
  const end = Math.max(target ?? today, today) + DAY_MS;
  const span = Math.max(end - start, DAY_MS);
  const x = (ms: number) => ((ms - start) / span) * CHART_W;
  const y = (n: number) => PAD_TOP + (1 - n / total) * (CHART_H - PAD_TOP);

  // Each day's count is plotted at the end of that day, from zero at the start.
  const endOf = (day: number) => day + DAY_MS;
  const points = [`${x(start)},${y(0)}`, ...series.map((p) => `${x(endOf(p.day))},${y(p.done)}`)];
  const last = series.at(-1)!;
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(endOf(today))},${CHART_H} L${x(start)},${CHART_H} Z`;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;

  const hovered = hover === null ? null : series[hover];

  return (
    <div className="relative">
      <div className="mb-1 flex justify-end gap-3 text-[11px] text-muted-foreground">
        <LegendSwatch className="bg-foreground/70">Done</LegendSwatch>
        {target !== null && <LegendSwatch dotted>Even pace</LegendSwatch>}
        {forecast.kind === "projected" && <LegendSwatch dashed>Forecast</LegendSwatch>}
      </div>
      <div className="relative h-40 text-foreground">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="size-full overflow-visible"
        role="img"
        aria-label={`Burn-up: ${last.done} of ${total} tasks done`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ms = start + ((e.clientX - rect.left) / rect.width) * span;
          const i = Math.round((ms - start) / DAY_MS) - 1;
          setHover(i >= 0 && i < series.length ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="burnup-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id="burnup-clip">
            <rect x="0" y="0" width={CHART_W} height={CHART_H} />
          </clipPath>
        </defs>

        <g clipPath="url(#burnup-clip)">
          {/* Scope */}
          <line
            x1={0}
            x2={CHART_W}
            y1={y(total)}
            y2={y(total)}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {/* Baseline */}
          <line
            x1={0}
            x2={CHART_W}
            y1={CHART_H}
            y2={CHART_H}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {/* Even pace to the target */}
          {target !== null && target > start && (
            <line
              x1={x(start)}
              y1={y(0)}
              x2={x(target + DAY_MS)}
              y2={y(total)}
              className="stroke-muted-foreground/40"
              strokeWidth={1.5}
              strokeDasharray="1 4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Target */}
          {target !== null && (
            <line
              x1={x(target + DAY_MS)}
              x2={x(target + DAY_MS)}
              y1={0}
              y2={CHART_H}
              className="stroke-muted-foreground/30"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path d={area} fill="url(#burnup-fill)" />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.7}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {forecast.kind === "projected" && (
            <line
              x1={x(endOf(today))}
              y1={y(last.done)}
              x2={x(endOf(forecast.finish))}
              y2={y(total)}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {hovered && (
            <line
              x1={x(endOf(hovered.day))}
              x2={x(endOf(hovered.day))}
              y1={0}
              y2={CHART_H}
              className="stroke-foreground/20"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>

      {/* Today's point — HTML so it stays round under preserveAspectRatio="none". */}
      <span
        className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
        style={{ left: pct(x(endOf(today)), CHART_W), top: pct(y(last.done), CHART_H) }}
      />

      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{ left: pct(x(endOf(hovered.day)), CHART_W) }}
        >
          <span className="text-muted-foreground">{fmtDay(hovered.day)}</span>
          <span className="ml-2 font-medium tabular-nums">{hovered.done} done</span>
        </div>
      )}
      </div>

      <div className="relative mt-1.5 h-4 text-[11px] text-muted-foreground">
        <span className="absolute left-0">{fmtDay(start)}</span>
        {target !== null && x(target + DAY_MS) < CHART_W * 0.92 && x(target + DAY_MS) > CHART_W * 0.15 ? (
          <span
            className="absolute -translate-x-1/2"
            style={{ left: `${(x(target + DAY_MS) / CHART_W) * 100}%` }}
          >
            Target
          </span>
        ) : null}
        <span className="absolute right-0">{target !== null && target >= today ? fmtDay(target) : "Today"}</span>
      </div>
    </div>
  );
}

function LegendSwatch({
  className,
  dotted,
  dashed,
  children,
}: {
  className?: string;
  dotted?: boolean;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {dotted || dashed ? (
        <span
          className={cn(
            "w-3 border-t-2",
            dotted && "border-dotted border-muted-foreground/50",
            dashed && "border-dashed border-foreground/35",
          )}
        />
      ) : (
        <span className={cn("h-0.5 w-3 rounded-full", className)} />
      )}
      {children}
    </span>
  );
}

// ── Status mix ──────────────────────────────────────────────────────

function StatusMix({ tasks, statuses }: { tasks: OverviewTask[]; statuses: Status[] }) {
  const mix = statusMix(tasks, statuses);
  const total = tasks.length;

  return (
    <div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {mix.map(({ status, count }) => (
          <li key={status._id} className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 rounded-full", status.color)} />
            <span className="text-muted-foreground">{status.name}</span>
            <span className="font-medium tabular-nums">{count}</span>
            <span className="tabular-nums text-muted-foreground/60">
              {Math.round((count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Needs attention ─────────────────────────────────────────────────

const SIGNALS: Record<SignalKey, { label: string; icon: typeof Ban; tone: string }> = {
  overdue: { label: "Overdue", icon: CalendarClock, tone: "text-destructive" },
  blocked: { label: "Blocked", icon: Ban, tone: "text-muted-foreground" },
  unowned: { label: "Urgent, no owner", icon: UserRoundX, tone: "text-muted-foreground" },
  stalled: { label: "Stalled in progress", icon: Hourglass, tone: "text-muted-foreground" },
};

/** Tasks listed under an expanded signal before "and N more". */
const SIGNAL_TASKS_SHOWN = 5;

function NeedsAttention({
  signals,
  now,
  onOpenTask,
}: {
  signals: Signal[];
  now: number;
  onOpenTask: (taskId: Id<"tasks">) => void;
}) {
  const [expanded, setExpanded] = useState<SignalKey | null>(null);

  return (
    <section className="rounded-xl border bg-card">
      <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">Needs attention</h2>
      {signals.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground">
          <CircleCheck className="size-4" />
          Nothing is overdue, blocked or stuck.
        </p>
      ) : (
        <ul className="pb-1.5">
          {signals.map((signal) => {
            const meta = SIGNALS[signal.key];
            const isOpen = expanded === signal.key;
            return (
              <li key={signal.key} className="border-t first:border-t-0">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : signal.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  <meta.icon className={cn("size-4 shrink-0", meta.tone)} />
                  <span className="flex-1">{meta.label}</span>
                  <span className="tabular-nums font-medium">{signal.tasks.length}</span>
                  <ChevronRight
                    className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")}
                  />
                </button>
                {isOpen && (
                  <ul className="animate-slide-down pb-2">
                    {signal.tasks.slice(0, SIGNAL_TASKS_SHOWN).map((task) => (
                      <li key={task._id}>
                        <button
                          type="button"
                          onClick={() => onOpenTask(task._id)}
                          className="flex w-full items-center gap-2 py-1.5 pl-10 pr-4 text-left text-sm transition-colors hover:bg-accent/50"
                        >
                          {getPriorityIcon(task.priority, "size-3.5 shrink-0")}
                          <TaskCode task={task} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {signalDetail(signal.key, task, now)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {signal.tasks.length > SIGNAL_TASKS_SHOWN && (
                      <li className="py-1 pl-10 text-xs text-muted-foreground">
                        and {signal.tasks.length - SIGNAL_TASKS_SHOWN} more
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The fact behind the flag, shown at the end of the task's row. */
function signalDetail(key: SignalKey, task: OverviewTask, now: number): string {
  if (key === "overdue" && task.dueDate) return formatDueDate(task.dueDate);
  if (key === "stalled") {
    const since = inProgressSince(task);
    if (since !== undefined) return `${Math.floor((now - since) / DAY_MS)}d`;
  }
  return "";
}

// ── Workload ────────────────────────────────────────────────────────

function Workload({ tasks }: { tasks: OverviewTask[] }) {
  const navigate = useNavigate();
  const rows = workload(tasks);
  const widest = Math.max(1, ...rows.map((r) => r.open + r.done));

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card">
      <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">Who's on what</h2>
      <ul className="pb-2">
        {rows.map((row) => (
          <li key={row.assigneeId ?? "unassigned"}>
            <button
              type="button"
              disabled={row.assigneeId === null}
              onClick={() =>
                row.assigneeId &&
                void navigate(`tasks${taskViewSearch({ filters: { assigneeIds: [row.assigneeId] }, view: "list" })}`)
              }
              className="group flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors enabled:hover:bg-accent/50"
            >
              {row.assigneeId ? (
                <UserAvatar name={row.name} image={row.image} className="size-6" fallbackClassName="text-[10px]" />
              ) : (
                <span className="size-6 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
              )}
              <span className="w-24 shrink-0 truncate text-sm">{row.assigneeId ? row.name : "Unassigned"}</span>
              <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                <span className="h-full bg-foreground/15" style={{ width: `${(row.done / widest) * 100}%` }} />
                <span
                  className="h-full bg-foreground/60"
                  style={{ width: `${(row.open / widest) * 100}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {row.open} open
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function NoCurrentCycle() {
  return (
    <section className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <RefreshCw className="mb-3 size-8 text-muted-foreground/40" />
      <h2 className="font-semibold">No cycle in progress</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Start or pick a current cycle and its progress shows up here.
      </p>
      <Link
        to="cycles"
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium hover:underline underline-offset-4"
      >
        Go to cycles <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
