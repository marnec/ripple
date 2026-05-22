import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, CircleCheck, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { KanbanCard } from "./KanbanCard";

type KanbanColumnProps = {
  status: {
    _id: Id<"taskStatuses">;
    name: string;
    color: string;
    order: number;
    isDefault: boolean;
    isCompleted: boolean;
    setsStartDate?: boolean;
    externalCloseReason?: "completed" | "not_planned";
  };
  tasks: Array<{
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
    pullRequestState?: "draft" | "open" | "merged" | "closed";
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
      image?: string;
    } | null;
  }>;
  totalCount?: number;
  onTaskClick: (taskId: string) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onDelete?: (reassignToStatusId: Id<"taskStatuses">) => void;
  /** Other statuses in the same project — candidates for task reassignment when this column is deleted. */
  reassignTargets: Array<{ _id: Id<"taskStatuses">; name: string; isDefault: boolean }>;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  /** Optional content rendered at the bottom of the task list. Used for the
   *  per-column completed-overflow pill on the kanban. */
  footer?: ReactNode;
};

export function KanbanColumn({
  status,
  tasks,
  totalCount,
  onTaskClick,
  onMoveLeft,
  onMoveRight,
  onDelete,
  reassignTargets,
  isFirst,
  isLast,
  canDelete,
  footer,
}: KanbanColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const defaultTargetId =
    reassignTargets.find((s) => s.isDefault)?._id ?? reassignTargets[0]?._id;
  const [reassignTargetId, setReassignTargetId] = useState<
    Id<"taskStatuses"> | undefined
  >(defaultTargetId);
  const hasTasks = (totalCount ?? tasks.length) > 0;
  const openDeleteDialog = () => {
    setReassignTargetId(defaultTargetId);
    setShowDeleteDialog(true);
  };

  const updateStatus = useMutation(api.taskStatuses.update);

  const { setNodeRef } = useDroppable({
    id: status._id,
  });

  const startRename = () => {
    setRenameValue(status.name);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameValue("");
  };

  const confirmRename = () => {
    const trimmedName = renameValue.trim();
    if (!trimmedName || trimmedName === status.name) {
      cancelRename();
      return;
    }

    void updateStatus({
      statusId: status._id,
      name: trimmedName,
    }).then(() => {
      setIsRenaming(false);
      setRenameValue("");
    });
  };

  const handleDeleteConfirm = () => {
    if (!reassignTargetId) return;
    setShowDeleteDialog(false);
    onDelete?.(reassignTargetId);
  };

  return (
    <>
      <div className="flex flex-col w-72 shrink-0 bg-muted/30 rounded-lg p-2">
        {/* Column Header */}
        <div className="flex items-center gap-2 px-2 py-3 mb-2">
          <span className={cn("w-2 h-2 rounded-full", status.color)} />
          {isRenaming ? (
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
                if (e.key === "Escape") cancelRename();
              }}
              className="h-7 flex-1 text-sm font-semibold"
            />
          ) : (
            <h3 className="font-semibold text-sm flex-1">{status.name}</h3>
          )}
          <Badge variant="secondary" className="text-xs">
            {totalCount !== undefined ? totalCount : tasks.length}
          </Badge>
          {/* Column Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
              />}
            >
                <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={startRename}>
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onMoveLeft}
                disabled={isFirst || !onMoveLeft}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Move Left
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onMoveRight}
                disabled={isLast || !onMoveRight}
              >
                <ChevronRight className="h-4 w-4 mr-2" />
                Move Right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void updateStatus({
                  statusId: status._id,
                  setsStartDate: !status.setsStartDate,
                })}
              >
                <CalendarClock className="h-4 w-4 mr-2" />
                Auto-set start date
                {status.setsStartDate && <Check className="h-4 w-4 ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void updateStatus({
                  statusId: status._id,
                  isCompleted: !status.isCompleted,
                })}
              >
                <CircleCheck className="h-4 w-4 mr-2" />
                Auto-set completed
                {status.isCompleted && <Check className="h-4 w-4 ml-auto" />}
              </DropdownMenuItem>

              {/* GitHub close-reason picker. Only meaningful when isCompleted=true:
                  closing a task in this status will push state_reason="not_planned"
                  to GitHub if "Won't do" is selected, or "completed" otherwise.
                  Defaults to "completed" semantics when no explicit choice is made. */}
              {status.isCompleted && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="pl-2 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      GitHub close as
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => void updateStatus({
                        statusId: status._id,
                        externalCloseReason: "completed",
                      })}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground mr-2 w-4">
                        ✓
                      </span>
                      Completed
                      {(status.externalCloseReason ?? "completed") === "completed" && (
                        <Check className="h-4 w-4 ml-auto" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void updateStatus({
                        statusId: status._id,
                        externalCloseReason: "not_planned",
                      })}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground mr-2 w-4">
                        ⊘
                      </span>
                      Won&apos;t do
                      {status.externalCloseReason === "not_planned" && (
                        <Check className="h-4 w-4 ml-auto" />
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={openDeleteDialog}
                disabled={!canDelete}
                className={canDelete ? "text-destructive" : ""}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {!canDelete ? "Default column" : "Delete Column"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      {/* Task List */}
      <div
        ref={setNodeRef}
        className="flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto overflow-x-hidden"
      >
        <SortableContext
          id={status._id}
          items={tasks.map((t) => t._id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center p-4 border-2 border-dashed rounded-lg text-muted-foreground text-sm">
              Drop tasks here
            </div>
          ) : (
            tasks.map((task) => (
              <KanbanCard
                key={task._id}
                task={task}
                onClick={() => onTaskClick(task._id)}
              />
            ))
          )}
        </SortableContext>
        {footer}
      </div>
    </div>

      {/* Delete Confirmation Dialog */}
      <ResponsiveDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Delete Column</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Delete &quot;{status.name}&quot; column? {hasTasks
                ? "Tasks in this column will be moved to the status you choose below. This cannot be undone."
                : "This cannot be undone."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {hasTasks && reassignTargets.length > 0 && (
            <div className="space-y-2 px-4 sm:px-0">
              <label className="text-sm font-medium">Reassign tasks to</label>
              <Select
                value={reassignTargetId}
                onValueChange={(value) => {
                  if (value) setReassignTargetId(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {reassignTargets.find((s) => s._id === reassignTargetId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {reassignTargets.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={hasTasks && !reassignTargetId}
            >
              Delete
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
