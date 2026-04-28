import { BacklinksDrawerTrigger } from "@/components/BacklinksDrawer";
import { RippleSpinner } from "@/components/RippleSpinner";
import { TagPickerButton } from "@/components/TagPickerButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUserColor } from "@/lib/user-colors";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { TaskProperties } from "./TaskProperties";
import { useTaskDetail } from "./useTaskDetail";

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
  // Defer heavy editor initialization (ProseMirror + Yjs) to unblock first paint.
  const [editorDeferred, setEditorDeferred] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEditorDeferred(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { titleInputRef, ...detail } = useTaskDetail({
    taskId,
    workspaceId,
    projectId,
    collaborationEnabled: editorDeferred,
  });
  const navigate = useNavigate();

  if (
    detail.task === undefined ||
    detail.statuses === undefined ||
    detail.members === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (detail.task === null) {
    return <ResourceDeleted resourceType="task" />;
  }

  const taskCode =
    detail.task.projectKey && detail.task.number !== undefined
      ? `${detail.task.projectKey}-${detail.task.number}`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Task toolbar — left: delete + tags + title + code, right: back-to-project */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex h-8 min-w-0 items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => detail.setShowDeleteDialog(true)}
            title="Delete task"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <TagPickerButton
            workspaceId={workspaceId}
            value={detail.task.labels ?? []}
            onChange={detail.handleSetTags}
          />
          {taskCode && (
            <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
              [ {taskCode} ]
            </span>
          )}
          <h1 className="truncate text-lg font-semibold">
            {detail.titleValue}
          </h1>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="w-full mx-auto px-3 md:px-6 pt-2 md:pt-6 max-w-4xl pb-6">
          <div className="mb-4 md:mb-6">
            <Input
              ref={titleInputRef}
              value={detail.titleValue}
              onChange={(e) => detail.setTitleValue(e.target.value)}
              onBlur={detail.handleTitleBlur}
              onKeyDown={detail.handleTitleKeyDown}
              className="text-lg md:text-2xl font-bold focus-visible:ring-0 md:h-10 h-7"
              placeholder="Task title"
            />
          </div>

        <div className="space-y-5 md:space-y-8">
          <TaskProperties
            task={detail.task}
            statuses={detail.statuses}
            members={detail.members}
            onStatusChange={detail.handleStatusChange}
            onPriorityChange={detail.handlePriorityChange}
            onAssigneeChange={detail.handleAssigneeChange}
            onSetTags={detail.handleSetTags}
            onRemoveTag={detail.handleRemoveTag}
            onDueDateChange={detail.handleDueDateChange}
            onStartDateChange={detail.handlePlannedStartDateChange}
            onEstimateChange={detail.handleEstimateChange}
          />

          <TaskDependencies
            taskId={taskId}
            workspaceId={workspaceId}
          />

          <BacklinksDrawerTrigger resourceId={taskId} workspaceId={workspaceId} />

          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Description
              </h3>
              <div className="flex items-center gap-2 min-h-8">
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
              spreadsheets={detail.spreadsheets}
              members={detail.members}
              className="min-h-50 md:min-h-75"
              hideLabel
            />
          </div>

          {detail.currentUser && (
            <div className="space-y-2 animate-fade-in">
              <TaskActivityTimeline
                taskId={taskId}
                currentUserId={detail.currentUser._id}
                workspaceId={workspaceId}
                members={detail.members}
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
      </div>
    </div>
  );
}
