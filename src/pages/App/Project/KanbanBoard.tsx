import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery } from "convex/react";
import { generateKeyBetween } from "fractional-indexing";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { AddColumnDialog } from "./AddColumnDialog";
import { KanbanCardPresenter } from "./KanbanCardPresenter";
import { KanbanColumn } from "./KanbanColumn";
import { TaskDetailSheet } from "./TaskDetailSheet";

type KanbanBoardProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
};

export function KanbanBoard({ projectId, workspaceId }: KanbanBoardProps) {
  const [hideCompleted, setHideCompleted] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [activeDragId, setActiveDragId] = useState<Id<"tasks"> | null>(null);
  const [showAddColumn, setShowAddColumn] = useState(false);

  const tasks = useQuery(api.tasks.listByProject, {
    projectId,
    hideCompleted,
  });

  const statuses = useQuery(api.taskStatuses.listByWorkspace, {
    workspaceId,
  });

  const updatePosition = useMutation(api.tasks.updatePosition).withOptimisticUpdate(
    (localStore, { taskId, statusId, position }) => {
      const currentTasks = localStore.getQuery(api.tasks.listByProject, {
        projectId,
        hideCompleted,
      });
      if (currentTasks === undefined) return;

      const updatedTasks = currentTasks.map((task) =>
        task._id === taskId ? { ...task, statusId, position } : task
      );
      localStore.setQuery(
        api.tasks.listByProject,
        { projectId, hideCompleted },
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

  // Group tasks by status and sort by position
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
    // Sort each group by position
    for (const key of Object.keys(grouped)) {
      grouped[key].sort(
        (a, b) =>
          (a.position ?? "").localeCompare(b.position ?? "") ||
          a._creationTime - b._creationTime
      );
    }
    return grouped;
  }, [tasks, statuses]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as Id<"tasks">);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || !tasks || !statuses) return;

    const activeTaskId = active.id as Id<"tasks">;
    const activeTask = tasks.find((t) => t._id === activeTaskId);
    if (!activeTask) return;

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

    // Get tasks in destination column, excluding the dragged task
    const columnTasks = (tasksByStatus[destinationStatusId] || []).filter(
      (t) => t._id !== activeTaskId
    );

    // Calculate insertion index
    let insertIndex = columnTasks.length; // default to end
    if (overData?.sortable?.index !== undefined) {
      insertIndex = overData.sortable.index;
      // If moving within same column and dropping after original position, adjust index
      if (
        activeTask.statusId === destinationStatusId &&
        overData.sortable.items
      ) {
        const originalIndex = overData.sortable.items.indexOf(activeTaskId);
        if (originalIndex !== -1 && insertIndex > originalIndex) {
          insertIndex -= 1;
        }
      }
    }

    // Calculate new position using fractional indexing
    const beforeTask = columnTasks[insertIndex - 1];
    const afterTask = columnTasks[insertIndex];
    const newPosition = generateKeyBetween(
      beforeTask?.position ?? null,
      afterTask?.position ?? null
    );

    // Update position
    void updatePosition({
      taskId: activeTaskId,
      statusId: destinationStatusId,
      position: newPosition,
    });
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
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="hide-completed-board"
            checked={hideCompleted}
            onCheckedChange={(checked) => setHideCompleted(checked === true)}
          />
          <Label
            htmlFor="hide-completed-board"
            className="text-sm font-normal cursor-pointer"
          >
            Hide completed
          </Label>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="flex gap-4 overflow-x-auto pb-4"
          style={{ minHeight: "calc(100vh - 200px)" }}
        >
          {statuses.map((status, index) => (
            <KanbanColumn
              key={status._id}
              status={status}
              tasks={tasksByStatus[status._id] || []}
              onTaskClick={(taskId) => setSelectedTaskId(taskId as Id<"tasks">)}
              onMoveLeft={() => handleMoveColumn(status._id, "left")}
              onMoveRight={() => handleMoveColumn(status._id, "right")}
              onDelete={() => handleDeleteColumn(status._id)}
              isFirst={index === 0}
              isLast={index === statuses.length - 1}
              canDelete={!status.isDefault && (tasksByStatus[status._id]?.length ?? 0) === 0}
            />
          ))}

          {/* Add Column Button */}
          <button
            onClick={() => setShowAddColumn(true)}
            className="flex flex-col w-72 h-32 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20 flex-shrink-0 items-center justify-center gap-2 hover:bg-muted/50 hover:border-muted-foreground/40 transition-colors cursor-pointer"
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
        workspaceId={workspaceId}
        open={showAddColumn}
        onOpenChange={setShowAddColumn}
      />
    </div>
  );
}
