import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { SwipeToReveal } from "@/components/SwipeToReveal";
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
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
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
      <div className="px-4 py-2.5 md:px-8 border-b">
        {isLoading ? (
          <div className="h-5 w-48 bg-muted animate-pulse rounded" />
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h2 className="text-sm font-semibold truncate">{cycle!.name}</h2>
              <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0", styles.badge)}>
                {cycle!.status}
              </span>
              {remaining !== null && remaining >= 0 && (
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                  {remaining === 0 ? "ends today" : `${remaining}d left`}
                </span>
              )}
              {dateRange && (
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{dateRange}</span>
              )}
              {/* Progress */}
              {cycle!.totalTasks > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${cycle!.progressPercent}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {cycle!.completedTasks}/{cycle!.totalTasks}
                  </span>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowEditDialog(true)}
              className="shrink-0 h-7 w-7"
              aria-label="Edit cycle"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Task toolbar + Add tasks button */}
      <div className="flex items-end gap-2 px-4 md:px-8 py-2 border-b">
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
          {
            isMobile ? "" : "Add tasks"
          }
          
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
              <SwipeToReveal
                key={task._id}
                enabled={isMobile}
                open={swipeOpenId === task._id}
                onOpenChange={(open) => setSwipeOpenId(open ? task._id : null)}
                onSwipeStart={() => setSwipeOpenId(null)}
                action={
                  <button
                    onClick={() =>
                      void removeTask({
                        cycleId,
                        taskId: task._id as Id<"tasks">,
                      })
                    }
                    className="flex items-center justify-center w-full bg-destructive text-destructive-foreground"
                    aria-label="Remove from cycle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <div className="group flex items-center gap-1">
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
                  {/* Remove from cycle — desktop hover only */}
                  {!isMobile && (
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
                  )}
                </div>
              </SwipeToReveal>
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

function AddTasksList({
  allTasks,
  available,
  existingTaskIds,
  selected,
  onToggle,
  search,
  onSearchChange,
}: {
  allTasks: { _id: string; title: string; status?: { color: string } }[] | undefined;
  available: { _id: string; title: string; status?: { color: string } }[];
  existingTaskIds: Set<string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <>
      <Input
        placeholder="Search tasks…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        autoFocus
      />

      <div className="max-h-64 overflow-y-auto space-y-1 mt-2">
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
              onClick={() => onToggle(task._id)}
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
    </>
  );
}

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
  const isMobile = useIsMobile();
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

  const addButtonLabel = selected.size > 0
    ? `Add ${selected.size} task${selected.size > 1 ? "s" : ""}`
    : "Add tasks";

  const listProps = {
    allTasks,
    available,
    existingTaskIds,
    selected,
    onToggle: handleToggle,
    search,
    onSearchChange: setSearch,
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add tasks to cycle</DrawerTitle>
          </DrawerHeader>
          <div className="px-4">
            <AddTasksList {...listProps} />
          </div>
          <DrawerFooter>
            <Button onClick={() => void handleAdd()} disabled={selected.size === 0 || saving}>
              {addButtonLabel}
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add tasks to cycle</DialogTitle>
        </DialogHeader>

        <div className="my-2">
          <AddTasksList {...listProps} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleAdd()} disabled={selected.size === 0 || saving}>
            {addButtonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
