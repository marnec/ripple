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
import { useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
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
          {statuses.map((status) => (
            <KanbanColumn
              key={status._id}
              status={status}
              tasks={tasksByStatus[status._id] || []}
              onTaskClick={(taskId) => setSelectedTaskId(taskId as Id<"tasks">)}
            />
          ))}
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
    </div>
  );
}
