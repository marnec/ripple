import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { formatDateRange, daysRemaining } from "./cycleUtils";

export function ProjectOverview() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectOverviewContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectOverviewContent({
  workspaceId: _workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const navigate = useNavigate();
  const project = useQuery(api.projects.get, { id: projectId });
  const tasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const cycles = useQuery(api.cycles.listByProject, { projectId });

  const openTasks = tasks?.filter((t) => !t.completed).length ?? 0;
  const completedTasks = tasks?.filter((t) => t.completed).length ?? 0;

  const activeCycle = cycles?.find((c) => c.status === "active") ?? null;
  const upcomingCycles = cycles
    ?.filter((c) => c.status === "upcoming")
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
    .slice(0, 3) ?? [];
  const hasCycles = (cycles?.length ?? 0) > 0;

  return (
    <div className="px-4 pt-6 md:px-8 md:pt-8 max-w-2xl space-y-8">
      {/* Description */}
      {project?.description && (
        <p className="text-muted-foreground">{project.description}</p>
      )}

      {/* Task stats */}
      <section>
        <div className="flex gap-4">
          <StatCard
            label="Open tasks"
            value={tasks === undefined ? "—" : String(openTasks)}
            onClick={() => void navigate("tasks")}
          />
          <StatCard
            label="Completed"
            value={tasks === undefined ? "—" : String(completedTasks)}
            onClick={() => void navigate("tasks")}
          />
        </div>
        <Link
          to="tasks"
          className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View all tasks →
        </Link>
      </section>

      {/* Cycles section — only shown if user has adopted cycles */}
      {hasCycles && (
        <section>
          {activeCycle ? (
            <ActiveCycleCard
              cycle={activeCycle}
              onView={() => void navigate(`cycles/${activeCycle._id}`)}
            />
          ) : upcomingCycles.length > 0 ? (
            <div className="text-sm text-muted-foreground">
              Next cycle:{" "}
              <button
                onClick={() => void navigate(`cycles/${upcomingCycles[0]._id}`)}
                className="font-medium text-foreground hover:underline"
              >
                {upcomingCycles[0].name}
              </button>
              {upcomingCycles[0].startDate && (
                <span>, starts {upcomingCycles[0].startDate}</span>
              )}
            </div>
          ) : null}
          <Link
            to="cycles"
            className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View all cycles →
          </Link>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent transition-colors min-w-[100px]"
    >
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
    </button>
  );
}

function ActiveCycleCard({
  cycle,
  onView,
}: {
  cycle: {
    _id: Id<"cycles">;
    name: string;
    startDate?: string;
    dueDate?: string;
    totalTasks: number;
    completedTasks: number;
    progressPercent: number;
  };
  onView: () => void;
}) {
  const remaining = daysRemaining(cycle.dueDate);

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
              Active cycle
            </span>
          </div>
          <p className="font-semibold truncate">{cycle.name}</p>
          {(cycle.startDate || cycle.dueDate) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDateRange(cycle.startDate, cycle.dueDate)}
              {remaining !== null && (
                <span className="ml-2">· {remaining === 0 ? "ends today" : `${remaining}d left`}</span>
              )}
            </p>
          )}

          {/* Progress bar */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${cycle.progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {cycle.completedTasks}/{cycle.totalTasks}
            </span>
          </div>
        </div>

        <button
          onClick={onView}
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View →
        </button>
      </div>
    </div>
  );
}
