import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { KanbanCard } from "./KanbanCard";

type KanbanColumnProps = {
  status: {
    _id: Id<"taskStatuses">;
    name: string;
    color: string;
    order: number;
    isDefault: boolean;
    setsStartDate?: boolean;
  };
  tasks: Array<{
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
      image?: string;
    } | null;
  }>;
  onTaskClick: (taskId: string) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onDelete?: () => void;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
};

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  onMoveLeft,
  onMoveRight,
  onDelete,
  isFirst,
  isLast,
  canDelete,
}: KanbanColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
    setShowDeleteDialog(false);
    onDelete?.();
  };

  return (
    <>
      <div className="flex flex-col w-64 md:w-72 bg-muted/30 rounded-lg p-2 flex-shrink-0">
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
              autoFocus
            />
          ) : (
            <h3 className="font-semibold text-sm flex-1">{status.name}</h3>
          )}
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
          {/* Column Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
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
        className="flex flex-col gap-2 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
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
      </div>
    </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Column</DialogTitle>
            <DialogDescription>
              Delete &quot;{status.name}&quot; column? Tasks in this column will be moved to the default status. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
