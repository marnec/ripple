import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { m } from "framer-motion";
import { generateKeyBetween } from "fractional-indexing";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { Plus } from "lucide-react";
import React, { Suspense, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AddColumnDialog } from "./AddColumnDialog";
import { KanbanCardPresenter } from "./KanbanCardPresenter";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCompletedOverflow } from "./KanbanCompletedOverflow";
import { KanbanFlyProvider, type RegisterCardNode } from "./kanbanFly";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);
import type { TaskFilters, TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";

const ANIMATION_DURATION_MS = 80;
const KANBAN_COMPLETED_CAP = 20;
/** Duration of the cross-column flying-card animation. */
const FLY_DURATION_S = 0.32;

/** One in-flight cross-column card animation: a ghost rendered in a viewport
 *  portal that travels from the task's old column rect to its new one. */
type Flight = {
  key: string;
  taskId: string;
  task: React.ComponentProps<typeof KanbanCardPresenter>["task"];
  src: DOMRect;
  dst: DOMRect;
};

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
  const isSorting = sort !== null;

  // Suppress motion layout animations during DnD — set in handleDragStart,
  // auto-cleared after the post-drop optimistic update applies — so motion
  // doesn't fight dnd-kit's drag transforms.
  const [dndSuppressed, setDndSuppressed] = useState(false);

  // --- Cross-column flying-card animation ---------------------------------
  // Cards live in per-column scroll containers that clip overflow, so a card
  // can't visually slide between columns in-flow. Instead, when a *remote*
  // change moves a task to another column, we render a ghost in a viewport
  // portal (above the columns, outside their clip boxes) and tween it from the
  // task's old on-screen rect to its new one. The real destination card stays
  // mounted but invisible until the ghost lands.
  const cardNodesRef = useRef(new Map<string, HTMLElement>());
  const prevRectsRef = useRef(new Map<string, DOMRect>());
  const prevStatusRef = useRef(new Map<string, string>());
  // Tasks moved by *this* client's drag — skip flying them (the drag gesture +
  // DragOverlay already gave the user positional feedback).
  const locallyMovedRef = useRef(new Set<string>());
  // Single state so the effect commits the new ghosts and their hidden-card
  // ids in one update (keeps it atomic and to one setState call).
  const [fly, setFly] = useState<{ flights: Flight[]; hidden: Set<string> }>({
    flights: [],
    hidden: new Set(),
  });

  const registerCardNode: RegisterCardNode = (taskId, el) => {
    if (el) cardNodesRef.current.set(taskId, el);
    // Intentionally NO delete on null. During a cross-column move the source
    // card unmounts (el=null) in the same commit the destination card mounts
    // under the same task id; depending on which subtree React commits first,
    // a delete here can wipe the freshly-registered destination node, so the
    // flight's destination rect goes missing and the animation is skipped.
    // Detached nodes are pruned lazily in the measurement loop instead.
  };

  const completeFlight = (key: string, taskId: string) => {
    setFly((current) => {
      const hidden = new Set(current.hidden);
      hidden.delete(taskId);
      return { flights: current.flights.filter((f) => f.key !== key), hidden };
    });
  };

  // Active tasks: full list. Completed: capped at KANBAN_COMPLETED_CAP+1 so we
  // can detect overflow via the +1 trick. Beyond the cap, the kanban surfaces
  // an overflow pill that links to the list view.
  const activeTasks = useQuery(api.tasks.listByProject, {
    projectId,
    completed: false,
  });
  const completedRaw = useQuery(api.tasks.listByProject, {
    projectId,
    completed: true,
    limit: KANBAN_COMPLETED_CAP + 1,
  });
  const completedTruncated = (completedRaw?.length ?? 0) > KANBAN_COMPLETED_CAP;
  const completedTasks = completedRaw?.slice(0, KANBAN_COMPLETED_CAP);
  const liveTasks =
    activeTasks && completedTasks ? [...activeTasks, ...completedTasks] : undefined;

  // Cards animate via Framer Motion layout animations (see KanbanCard), so we
  // render live query data directly — no View Transition buffering needed.
  // Motion animates only real layout changes, so data updates that don't move
  // a card (e.g. the description-seed sync when a TaskDetailSheet closes)
  // produce no animation, and because the animation is an in-flow transform it
  // stays clipped by the column's scroll container instead of flashing on top.
  const allTasks = liveTasks;

  // Apply assignee/priority filters + optional sort
  const tasks = useFilteredTasks(allTasks, filters, sort);

  const statuses = useQuery(api.taskStatuses.listByProject, {
    projectId,
  });

  const updatePosition = useMutation(api.tasks.updatePosition).withOptimisticUpdate(
    (localStore, { taskId, statusId, position }) => {
      // Patch whichever query holds the task. Cross-completion moves (e.g.
      // dropping into Done) settle when the server commits the completed
      // flip; until then the task stays in its source query with the new
      // statusId, which still groups it into the right kanban column.
      const updateBucket = (
        args: { projectId: Id<"projects">; completed: boolean; limit?: number },
      ) => {
        const current = localStore.getQuery(api.tasks.listByProject, args);
        if (current === undefined) return;
        localStore.setQuery(
          api.tasks.listByProject,
          args,
          current.map((task) =>
            task._id === taskId ? { ...task, statusId, position } : task,
          ),
        );
      };
      updateBucket({ projectId, completed: false });
      updateBucket({ projectId, completed: true, limit: KANBAN_COMPLETED_CAP + 1 });
    }
  );

  const reorderColumns = useMutation(api.taskStatuses.reorderColumns);
  const removeStatus = useMutation(api.taskStatuses.remove);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Group tasks by status; when sort active, preserve sort order from useFilteredTasks
  const tasksByStatus = (() => {
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
  })();

  // Total task counts per status (always from allTasks, ignoring hide filter)
  const totalCountByStatus = (() => {
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
  })();

  // After every commit: measure current card rects, diff each task's statusId
  // against the previous commit, and launch a flight for any task that changed
  // column remotely. Runs before paint so the destination card is hidden and
  // the ghost mounted without a flash. dndSuppressed is excluded as a dep on
  // purpose — we read refs, not reactive values.
  useLayoutEffect(() => {
    if (!tasks) return;

    const currentRects = new Map<string, DOMRect>();
    for (const [id, el] of cardNodesRef.current) {
      // Prune detached nodes left behind by unmounts (see registerCardNode).
      if (!el.isConnected) {
        cardNodesRef.current.delete(id);
        continue;
      }
      currentRects.set(id, el.getBoundingClientRect());
    }

    const newFlights: Flight[] = [];
    for (const task of tasks) {
      const prevStatus = prevStatusRef.current.get(task._id);
      const moved = prevStatus && prevStatus !== task.statusId;
      if (!moved || locallyMovedRef.current.has(task._id)) continue;

      const src = prevRectsRef.current.get(task._id);
      const dst = currentRects.get(task._id);
      // Skip if either endpoint is unmeasurable (e.g. card off-screen / behind
      // the completed-overflow pill) or the move didn't actually shift pixels.
      if (!src || !dst) continue;
      if (Math.abs(src.left - dst.left) < 1 && Math.abs(src.top - dst.top) < 1) {
        continue;
      }
      newFlights.push({
        key: `${task._id}:${performance.now()}`,
        taskId: task._id,
        task,
        src,
        dst,
      });
    }

    // Roll refs forward for the next diff.
    prevRectsRef.current = currentRects;
    const nextStatus = new Map<string, string>();
    for (const task of tasks) nextStatus.set(task._id, task.statusId);
    prevStatusRef.current = nextStatus;
    locallyMovedRef.current.clear();

    if (newFlights.length > 0) {
      // FLIP requires measuring rects in a layout effect, then committing the
      // ghosts before paint — setState here is intentional, not a sync bug.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFly((current) => ({
        flights: [...current.flights, ...newFlights],
        hidden: new Set([
          ...current.hidden,
          ...newFlights.map((flight) => flight.taskId),
        ]),
      }));
    }
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setDndSuppressed(true);
    setActiveDragId(event.active.id as Id<"tasks">);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || !tasks || !statuses) {
      setDndSuppressed(false);
      return;
    }

    const activeTaskId = active.id as Id<"tasks">;
    const activeTask = tasks.find((t) => t._id === activeTaskId);
    if (!activeTask) {
      setDndSuppressed(false);
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
      setDndSuppressed(false);
      toast.error("Clear sorting to reorder tasks within a column.", {
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

    // This client moved the task by hand — exclude it from the flying-card
    // animation (the drag + DragOverlay already showed it travelling).
    locallyMovedRef.current.add(activeTaskId);

    // Update position — dndSuppressed stays true through this render cycle
    // so the optimistic update applies without a view transition.
    // Re-enable after the server confirms + React processes the update.
    void updatePosition({
      taskId: activeTaskId,
      statusId: destinationStatusId,
      position: newPosition,
    })
      .catch((err: unknown) => {
        toast.error("Couldn't move task", {
          description: getErrorMessage(err),
        });
      })
      .finally(() => {
        requestAnimationFrame(() => {
          setDndSuppressed(false);
        });
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

  // Column delete handler — caller picks the target status that orphaned tasks
  // should be reassigned to. The mutation enqueues a workpool action that
  // drains the column in batches and finally deletes the row.
  const handleDeleteColumn = (
    statusId: Id<"taskStatuses">,
    reassignToStatusId: Id<"taskStatuses">,
  ) => {
    void removeStatus({ statusId, reassignToStatusId });
  };

  if (tasks === undefined || statuses === undefined) {
    return null;
  }

  return (
    <KanbanFlyProvider value={registerCardNode}>
    <div className="flex flex-col flex-1 min-h-0 animate-fade-in">
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
              onDelete={(reassignToStatusId) =>
                handleDeleteColumn(status._id, reassignToStatusId)
              }
              reassignTargets={statuses
                .filter((s) => s._id !== status._id)
                .map((s) => ({ _id: s._id, name: s.name, isDefault: s.isDefault }))}
              isFirst={index === 0}
              isLast={index === statuses.length - 1}
              canDelete={!status.isDefault}
              layoutEnabled={!dndSuppressed}
              hiddenTaskIds={fly.hidden}
              footer={
                completedTruncated && status.isCompleted ? (
                  <KanbanCompletedOverflow
                    workspaceId={workspaceId}
                    projectId={projectId}
                  />
                ) : undefined
              }
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

        {/* Drag Overlay — near-instant drop so cards are immediately responsive */}
        <DragOverlay dropAnimation={{ duration: ANIMATION_DURATION_MS, easing: "ease-out" }}>
          {activeTask && (
            <KanbanCardPresenter
              task={activeTask}
              onClick={() => { }}
              isDragging
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Task Detail Sheet */}
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

      {/* Add Column Dialog */}
      <AddColumnDialog
        projectId={projectId}
        open={showAddColumn}
        onOpenChange={setShowAddColumn}
      />
    </div>

    {/* Flying-card overlay — ghosts that travel between columns for remote
        cross-column moves. Rendered to <body> so they escape each column's
        overflow clip box. The fixed full-viewport layer lets children use
        viewport (getBoundingClientRect) coordinates directly. */}
    {fly.flights.length > 0 &&
      createPortal(
        <div className="fixed inset-0 z-50 pointer-events-none">
          {fly.flights.map((flight) => (
            <m.div
              key={flight.key}
              className="absolute"
              style={{
                top: flight.src.top,
                left: flight.src.left,
                width: flight.src.width,
              }}
              initial={{ x: 0, y: 0 }}
              animate={{
                x: flight.dst.left - flight.src.left,
                y: flight.dst.top - flight.src.top,
              }}
              transition={{ duration: FLY_DURATION_S, ease: [0.16, 1, 0.3, 1] }}
              onAnimationComplete={() => completeFlight(flight.key, flight.taskId)}
            >
              <KanbanCardPresenter task={flight.task} onClick={() => {}} />
            </m.div>
          ))}
        </div>,
        document.body,
      )}
    </KanbanFlyProvider>
  );
}
