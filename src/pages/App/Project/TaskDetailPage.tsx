import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { TaskProperties } from "./TaskProperties";
import { useTaskDetail } from "./useTaskDetail";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { getUserColor } from "@/lib/user-colors";
import { formatTaskId } from "@/lib/task-utils";

export function TaskDetailPage() {
  const { workspaceId, projectId, taskId } = useParams<QueryParams>();

  if (!workspaceId || !projectId || !taskId) {
    return <SomethingWentWrong />;
  }

  return (
    <TaskDetailPageContent
      workspaceId={workspaceId}
      projectId={projectId}
      taskId={taskId}
    />
  );
}

function TaskDetailPageContent({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
}) {
  const { titleInputRef, ...detail } = useTaskDetail({ taskId, workspaceId, projectId });
  const navigate = useNavigate();

  if (
    detail.task === undefined ||
    detail.statuses === undefined ||
    detail.members === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (detail.task === null) {
    return <SomethingWentWrong />;
  }

  return (
    <div className="container mx-auto py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              void navigate(
                `/workspaces/${workspaceId}/projects/${projectId}`
              )
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            {(() => {
              const taskIdStr = formatTaskId(detail.task.projectKey, detail.task.number);
              return taskIdStr ? (
                <span className="text-xs text-muted-foreground font-mono ml-1">
                  {taskIdStr}
                </span>
              ) : null;
            })()}
            <Input
              ref={titleInputRef}
              value={detail.titleValue}
              onChange={(e) => detail.setTitleValue(e.target.value)}
              onBlur={detail.handleTitleBlur}
              onKeyDown={detail.handleTitleKeyDown}
              className="text-2xl font-bold border-none focus-visible:ring-0 px-0 h-auto"
              placeholder="Task title"
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => detail.setShowDeleteDialog(true)}
          title="Delete task"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <div className="space-y-8">
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
            className="min-h-75"
            hideLabel
          />
        </div>

        {detail.currentUser && (
          <div className="space-y-2">
            <TaskActivityTimeline
              taskId={taskId}
              currentUserId={detail.currentUser._id}
              workspaceId={workspaceId}
            />
          </div>
        )}
      </div>

      <TaskDeleteDialog
        open={detail.showDeleteDialog}
        onOpenChange={detail.setShowDeleteDialog}
        onConfirm={() =>
          detail.handleDelete(() => {
            void navigate(
              `/workspaces/${workspaceId}/projects/${projectId}`
            );
          })
        }
      />
    </div>
  );
}
