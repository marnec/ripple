import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery } from "convex/react";
import { generateKeyBetween } from "fractional-indexing";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/components/ui/use-toast";
import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useAnimatedQuery, isPositionOnlyChange } from "@/hooks/use-animated-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { AddColumnDialog } from "./AddColumnDialog";
import { CreateTaskInline } from "./CreateTaskInline";
import { KanbanCardPresenter } from "./KanbanCardPresenter";
import { KanbanColumn } from "./KanbanColumn";
import { TaskDetailSheet } from "./TaskDetailSheet";
import type { TaskFilters, TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";

type KanbanBoardProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  filters: TaskFilters;
  sort: TaskSort;
  onSortBlocked?: () => void;
};

// pointerWithin detects which column the pointer is in (works for empty columns);
// fall back to closestCorners when pointer isn't inside any droppable
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return within;
  return closestCorners(args);
};

export function KanbanBoard({ projectId, workspaceId, filters, sort, onSortBlocked }: KanbanBoardProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [activeDragId, setActiveDragId] = useState<Id<"tasks"> | null>(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [showAddColumn, setShowAddColumn] = useState(false);
  const { toast } = useToast();
  const isSorting = sort !== null;

  // Suppress view transitions during DnD — set in handleDragStart,
  // auto-cleared by the hook after the post-drop optimistic update applies.
  const suppressTransition = useRef(false);

  // Always fetch all tasks — filter client-side to avoid flash on toggle
  const liveTasks = useQuery(api.tasks.listByProject, {
    projectId,
    hideCompleted: false,
  });

  // Buffer remote updates through View Transitions so cards animate.
  // When sorting is active, absorb position-only reorders from other users
  // since the sort override makes them invisible.
  const allTasks = useAnimatedQuery(
    liveTasks,
    isSorting ? isPositionOnlyChange : undefined,
    suppressTransition,
  );

  // Apply assignee/priority filters + optional sort
  const tasks = useFilteredTasks(allTasks, filters, sort);

  const statuses = useQuery(api.taskStatuses.listByProject, {
    projectId,
  });

  const updatePosition = useMutation(api.tasks.updatePosition).withOptimisticUpdate(
    (localStore, { taskId, statusId, position }) => {
      const currentTasks = localStore.getQuery(api.tasks.listByProject, {
        projectId,
        hideCompleted: false,
      });
      if (currentTasks === undefined) return;

      const updatedTasks = currentTasks.map((task) =>
        task._id === taskId ? { ...task, statusId, position } : task
      );
      localStore.setQuery(
        api.tasks.listByProject,
        { projectId, hideCompleted: false },
        updatedTasks
      );
    }
  );

  const reorderColumns = useMutation(api.taskStatuses.reorderColumns);
  const removeStatus = useMutation(api.taskStatuses.remove);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Group tasks by status; when sort active, preserve sort order from useFilteredTasks
  const tasksByStatus = useMemo(() => {
    if (!tasks || !statuses) return {};

    const grouped: Record<string, typeof tasks> = {};
    for (const status of statuses) {
      grouped[status._id] = [];
    }
    for (const task of tasks) {
      if (grouped[task.statusId]) {
        grouped[task.statusId].push(task);
      }
    }
    // Only apply position sort when no explicit sort is active.
    // Use plain < / > comparison (character-code order) — localeCompare
    // is case-insensitive and mis-orders fractional-indexing strings.
    if (!isSorting) {
      for (const key of Object.keys(grouped)) {
        grouped[key].sort((a, b) => {
          const pa = a.position ?? "";
          const pb = b.position ?? "";
          if (pa < pb) return -1;
          if (pa > pb) return 1;
          return a._creationTime - b._creationTime;
        });
      }
    }
    return grouped;
  }, [tasks, statuses, isSorting]);

  // Total task counts per status (always from allTasks, ignoring hide filter)
  const totalCountByStatus = useMemo(() => {
    if (!allTasks || !statuses) return {};
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      counts[status._id] = 0;
    }
    for (const task of allTasks) {
      if (counts[task.statusId] !== undefined) {
        counts[task.statusId]++;
      }
    }
    return counts;
  }, [allTasks, statuses]);

  const handleDragStart = (event: DragStartEvent) => {
    suppressTransition.current = true;
    setActiveDragId(event.active.id as Id<"tasks">);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || !tasks || !statuses) {
      suppressTransition.current = false;
      return;
    }

    const activeTaskId = active.id as Id<"tasks">;
    const activeTask = tasks.find((t) => t._id === activeTaskId);
    if (!activeTask) {
      suppressTransition.current = false;
      return;
    }

    // Determine destination status
    let destinationStatusId: Id<"taskStatuses">;
    const overData = over.data.current;

    if (overData?.sortable) {
      // Dropped on a task - use the container ID (statusId)
      destinationStatusId = overData.sortable.containerId as Id<"taskStatuses">;
    } else {
      // Dropped on empty column
      destinationStatusId = over.id as Id<"taskStatuses">;
    }

    // When sorting is active, allow cross-column moves (status change) but
    // block same-column reorder since the sort overrides manual position.
    if (isSorting && activeTask.statusId === destinationStatusId) {
      suppressTransition.current = false;
      toast({
        description: "Clear sorting to reorder tasks within a column.",
        variant: "destructive",
        duration: 2500,
      });
      onSortBlocked?.();
      return;
    }

    // Get tasks in destination column, excluding the dragged task
    const columnTasks = (tasksByStatus[destinationStatusId] || []).filter(
      (t) => t._id !== activeTaskId
    );

    // Calculate insertion index.
    // overData.sortable.index is the over item's position in the original items
    // array. When the active item is removed from columnTasks, items after it
    // shift up by 1 — but for "drag down" we want to insert AFTER the over
    // item, which naturally compensates. No adjustment is needed.
    let insertIndex = columnTasks.length; // default to end
    if (overData?.sortable?.index !== undefined) {
      insertIndex = overData.sortable.index;
    }

    // Calculate new position using fractional indexing
    const beforeTask = columnTasks[insertIndex - 1];
    const afterTask = columnTasks[insertIndex];
    const newPosition = generateKeyBetween(
      beforeTask?.position ?? null,
      afterTask?.position ?? null
    );

    // Update position — suppress ref stays true through this render cycle
    // so the optimistic update applies without a view transition.
    void updatePosition({
      taskId: activeTaskId,
      statusId: destinationStatusId,
      position: newPosition,
    });

    // Keep view transitions suppressed until dnd-kit's default drop animation
    // (~250ms) has fully completed — otherwise a Convex server update arriving
    // mid-animation triggers a view-transition fade on the settling card.
    setTimeout(() => {
      suppressTransition.current = false;
    }, 300);
  };

  // Get active task for drag overlay
  const activeTask = activeDragId
    ? tasks?.find((t) => t._id === activeDragId)
    : null;

  // Column reorder handler
  const handleMoveColumn = (
    statusId: Id<"taskStatuses">,
    direction: "left" | "right"
  ) => {
    if (!statuses) return;

    const sortedStatuses = [...statuses].sort((a, b) => a.order - b.order);
    const currentIndex = sortedStatuses.findIndex((s) => s._id === statusId);
    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= sortedStatuses.length) return;

    // Swap positions in the array
    const reordered = [...sortedStatuses];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    // Call reorderColumns with new order
    void reorderColumns({ statusIds: reordered.map((s) => s._id) });
  };

  // Column delete handler
  const handleDeleteColumn = (statusId: Id<"taskStatuses">) => {
    void removeStatus({ statusId });
  };

  if (tasks === undefined || statuses === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Create task — matches list view layout */}
      <CreateTaskInline projectId={projectId} workspaceId={workspaceId} />

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="flex flex-1 min-h-0 gap-4 overflow-x-auto pb-4"
        >
          {statuses.map((status, index) => (
            <KanbanColumn
              key={status._id}
              status={status}
              tasks={tasksByStatus[status._id] || []}
              totalCount={totalCountByStatus[status._id] ?? 0}
              onTaskClick={(taskId) => {
                if (isMobile) {
                  void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`);
                } else {
                  setSelectedTaskId(taskId as Id<"tasks">);
                }
              }}
              onMoveLeft={() => handleMoveColumn(status._id, "left")}
              onMoveRight={() => handleMoveColumn(status._id, "right")}
              onDelete={() => handleDeleteColumn(status._id)}
              isFirst={index === 0}
              isLast={index === statuses.length - 1}
              canDelete={!status.isDefault}
            />
          ))}

          {/* Add Column Button */}
          <button
            onClick={() => setShowAddColumn(true)}
            className="flex flex-col w-72 shrink-0 h-32 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20 items-center justify-center gap-2 hover:bg-muted/50 hover:border-muted-foreground/40 transition-colors cursor-pointer"
          >
            <Plus className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium">
              Add Column
            </span>
          </button>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeTask && (
            <KanbanCardPresenter
              task={activeTask}
              onClick={() => {}}
              isDragging
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Task Detail Sheet */}
      <TaskDetailSheet
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
        workspaceId={workspaceId}
        projectId={projectId}
      />

      {/* Add Column Dialog */}
      <AddColumnDialog
        projectId={projectId}
        open={showAddColumn}
        onOpenChange={setShowAddColumn}
      />
    </div>
  );
}
