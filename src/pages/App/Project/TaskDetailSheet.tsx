import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Maximize2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { TaskComments } from "./TaskComments";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { TaskDependencies } from "./TaskDependencies";
import { TaskProperties } from "./TaskProperties";
import { useTaskDetail } from "./useTaskDetail";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { getUserColor } from "@/lib/user-colors";
import { formatTaskId } from "@/lib/task-utils";

type TaskDetailSheetProps = {
  taskId: Id<"tasks"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

export function TaskDetailSheet({
  taskId,
  open,
  onOpenChange,
  workspaceId,
  projectId,
}: TaskDetailSheetProps) {
  const { titleInputRef, ...detail } = useTaskDetail({ taskId, workspaceId, projectId });
  const navigate = useNavigate();

  if (!taskId || !detail.task) {
    return null;
  }

  if (detail.statuses === undefined || detail.members === undefined) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full md:w-[44rem] overflow-y-auto">
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full md:w-[44rem] overflow-y-auto">
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-12 top-4 rounded-sm opacity-70 hover:opacity-100 h-auto w-auto p-0"
            onClick={() =>
              void navigate(
                `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`
              )
            }
            title="Expand to full page"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <SheetHeader>
            {(() => {
              const taskIdStr = formatTaskId(detail.task.projectKey, detail.task.number);
              return taskIdStr ? (
                <span className="text-xs text-muted-foreground font-mono ml-1">
                  {taskIdStr}
                </span>
              ) : null;
            })()}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => detail.setShowDeleteDialog(true)}
                title="Delete task"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              <Input
                ref={titleInputRef}
                value={detail.titleValue}
                onChange={(e) => detail.setTitleValue(e.target.value)}
                onBlur={detail.handleTitleBlur}
                onKeyDown={detail.handleTitleKeyDown}
                className="text-lg font-semibold border-none focus-visible:ring-0 px-0 h-auto"
                placeholder="Task title"
              />
            </div>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <TaskProperties
              task={detail.task}
              statuses={detail.statuses}
              members={detail.members}
              onStatusChange={detail.handleStatusChange}
              onPriorityChange={detail.handlePriorityChange}
              onAssigneeChange={detail.handleAssigneeChange}
              onAddLabel={detail.handleAddLabel}
              onRemoveLabel={detail.handleRemoveLabel}
              onDueDateChange={detail.handleDueDateChange}
              onStartDateChange={detail.handleStartDateChange}
              onEstimateChange={detail.handleEstimateChange}
            />

            <TaskDependencies
              taskId={taskId}
              workspaceId={workspaceId}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Description
                </h3>
                <div className="flex items-center gap-2">
                  <ConnectionStatus isConnected={detail.isConnected} />
                  {detail.isConnected && (
                    <ActiveUsers
                      remoteUsers={detail.remoteUsers}
                      currentUser={
                        detail.currentUser
                          ? {
                              name: detail.currentUser.name,
                              color: getUserColor(detail.currentUser._id),
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>
              <TaskDescriptionEditor
                editor={detail.editor}
                documents={detail.documents}
                diagrams={detail.diagrams}
                members={detail.members}
                className="min-h-50"
                hideLabel
              />
            </div>

            {detail.currentUser && (
              <div className="space-y-2">
                <TaskComments
                  taskId={taskId}
                  currentUserId={detail.currentUser._id}
                  workspaceId={workspaceId}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <TaskDeleteDialog
        open={detail.showDeleteDialog}
        onOpenChange={detail.setShowDeleteDialog}
        onConfirm={() => detail.handleDelete(() => onOpenChange(false))}
      />
    </>
  );
}
