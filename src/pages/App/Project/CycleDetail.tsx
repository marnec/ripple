import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { TaskRow } from "./TaskRow";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";
import { CYCLE_STATUS_STYLES, formatDateRange, daysRemaining } from "./cycleUtils";
import { EditCycleDialog } from "./EditCycleDialog";

export function CycleDetail() {
  const { workspaceId, projectId, cycleId } = useParams<QueryParams>();

  if (!workspaceId || !projectId || !cycleId) {
    return <SomethingWentWrong />;
  }

  return (
    <CycleDetailContent
      workspaceId={workspaceId}
      projectId={projectId}
      cycleId={cycleId}
    />
  );
}

function CycleDetailContent({
  workspaceId,
  projectId,
  cycleId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  cycleId: Id<"cycles">;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({
    hideCompleted: false,
    assigneeIds: [],
    priorities: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const cycle = useQuery(api.cycles.get, { cycleId });
  const cycleTasks = useQuery(api.cycles.listCycleTasks, { cycleId, hideCompleted: false });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.cycles.removeTask);

  const filteredTasks = useFilteredTasks(cycleTasks, filters, sort);

  if (cycle === null) {
    return <SomethingWentWrong />;
  }

  const isLoading = cycle === undefined;
  const cycleStatus = cycle?.status as "draft" | "upcoming" | "active" | "completed" | undefined;
  const styles = cycleStatus ? CYCLE_STATUS_STYLES[cycleStatus] : CYCLE_STATUS_STYLES.draft;
  const dateRange = cycle ? formatDateRange(cycle.startDate as string | undefined, cycle.dueDate as string | undefined) : "";
  const remaining = cycle ? daysRemaining(cycle.dueDate as string | undefined) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Cycle header */}
      <div className="px-4 pt-5 pb-4 md:px-8 border-b">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", styles.badge)}>
                  {cycle!.status}
                </span>
                {remaining !== null && remaining >= 0 && (
                  <span className="text-xs text-muted-foreground">
                    {remaining === 0 ? "ends today" : `${remaining}d left`}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-semibold truncate">{cycle!.name}</h2>
              {dateRange && (
                <p className="text-sm text-muted-foreground mt-0.5">{dateRange}</p>
              )}

              {/* Progress */}
              {cycle!.totalTasks > 0 && (
                <div className="mt-2 flex items-center gap-2 max-w-xs">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${cycle!.progressPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {cycle!.completedTasks}/{cycle!.totalTasks} · {cycle!.progressPercent}%
                  </span>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowEditDialog(true)}
              className="shrink-0"
              aria-label="Edit cycle"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Task toolbar + Add tasks button */}
      <div className="flex items-center gap-2 px-4 md:px-8 py-2 border-b">
        <div className="flex-1">
          <TaskToolbar
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            members={members ?? []}
            sortBlocked={false}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDialog(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add tasks
        </Button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-3">
        {filteredTasks === undefined ? null : filteredTasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {cycleTasks?.length === 0
              ? "No tasks in this cycle. Add some tasks to get started."
              : "No tasks match the current filters."}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filteredTasks.map((task) => (
              <div key={task._id} className="group relative flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <TaskRow
                    task={task}
                    statuses={statuses ?? undefined}
                    onStatusChange={(statusId) => {
                      void updateTask({
                        taskId: task._id as Id<"tasks">,
                        statusId: statusId as Id<"taskStatuses">,
                      });
                    }}
                    onClick={() => {
                      if (isMobile) {
                        void navigate(
                          `/workspaces/${workspaceId}/projects/${projectId}/tasks/${task._id}`
                        );
                      } else {
                        setSelectedTaskId(task._id as Id<"tasks">);
                      }
                    }}
                  />
                </div>
                {/* Remove from cycle */}
                <button
                  onClick={() =>
                    void removeTask({
                      cycleId,
                      taskId: task._id as Id<"tasks">,
                    })
                  }
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-accent"
                  aria-label="Remove from cycle"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Task detail sheet (desktop) */}
      <TaskDetailSheet
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        workspaceId={workspaceId}
        projectId={projectId}
      />

      {/* Add tasks dialog */}
      <AddTasksToCycleDialog
        cycleId={cycleId}
        projectId={projectId}
        workspaceId={workspaceId}
        existingTaskIds={new Set(cycleTasks?.map((t) => t._id as string) ?? [])}
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
      />

      {/* Edit cycle dialog */}
      {cycle && showEditDialog && (
        <EditCycleDialog
          cycle={cycle}
          open={showEditDialog}
          onOpenChange={(open) => {
            setShowEditDialog(open);
            if (!open && cycle.status === "completed") {
              // If cycle was just removed it won't load; stay on page
            }
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Add Tasks Dialog
// ────────────────────────────────────────────────────────────────────────────

function AddTasksToCycleDialog({
  cycleId,
  projectId,
  workspaceId: _workspaceId,
  existingTaskIds,
  open,
  onOpenChange,
}: {
  cycleId: Id<"cycles">;
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  existingTaskIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const allTasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const addTask = useMutation(api.cycles.addTask);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const available = (allTasks ?? []).filter(
    (t) =>
      !existingTaskIds.has(t._id) &&
      t.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        [...selected].map((taskId) =>
          addTask({ cycleId, taskId: taskId as Id<"tasks"> })
        )
      );
      setSelected(new Set());
      setSearch("");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add tasks to cycle</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="my-2"
          autoFocus
        />

        <div className="max-h-64 overflow-y-auto space-y-1">
          {allTasks === undefined ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
          ) : available.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {allTasks.length === existingTaskIds.size
                ? "All tasks are already in this cycle."
                : "No tasks match."}
            </div>
          ) : (
            available.map((task) => (
              <button
                key={task._id}
                onClick={() => handleToggle(task._id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors",
                  selected.has(task._id)
                    ? "bg-primary/10"
                    : "hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                    selected.has(task._id)
                      ? "bg-primary border-primary"
                      : "border-input"
                  )}
                >
                  {selected.has(task._id) && (
                    <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate">{task.title}</span>
                {task.status && (
                  <span
                    className={cn("w-2 h-2 rounded-full shrink-0", task.status.color)}
                  />
                )}
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleAdd()} disabled={selected.size === 0 || saving}>
            Add {selected.size > 0 ? `${selected.size} task${selected.size > 1 ? "s" : ""}` : "tasks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
