import { BacklinksDrawerTrigger } from "@/components/BacklinksDrawer";
import { RippleSpinner } from "@/components/RippleSpinner";
import { TagPickerButton } from "@/components/TagPickerButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { getUserColor } from "@/lib/user-colors";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { SeedingDescriptionNotice } from "./SeedingDescriptionNotice";
import { TaskProperties } from "./TaskProperties";
import { TaskDescriptionSyncButton } from "./TaskDescriptionSyncButton";
import { TaskGithubExternalInfo } from "./TaskGithubExternalInfo";
import { TaskPullRequests } from "./TaskPullRequests";
import { TaskSyncIndicator } from "./TaskSyncIndicator";
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
  const isMobile = useIsMobile();

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
      {/* Task toolbar — desktop only. On mobile, the breadcrumb shows
          the task code + title and the delete action moves to HeaderSlot. */}
      {!isMobile && (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
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
            <span className="shrink-0 text-sm text-muted-foreground">
              [ {taskCode} ]
            </span>
          )}
          <TaskSyncIndicator taskId={taskId} />
          <Input
            ref={titleInputRef}
            value={detail.titleValue}
            onChange={(e) => detail.setTitleValue(e.target.value)}
            onBlur={detail.handleTitleBlur}
            onKeyDown={detail.handleTitleKeyDown}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-lg font-semibold shadow-none focus-visible:ring-0"
            placeholder="Task title"
          />
          {(() => {
            const issueUrl = detail.task.externalRefs?.[0]?.url;
            return (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0"
                disabled={!issueUrl}
                onClick={() =>
                  issueUrl &&
                  window.open(issueUrl, "_blank", "noopener,noreferrer")
                }
                title={
                  issueUrl ? "Open linked issue on GitHub" : "No linked issue"
                }
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            );
          })()}
        </div>
      )}

      {isMobile && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => detail.setShowDeleteDialog(true)}
            aria-label="Delete task"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={detail.titleValue} />

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-430 flex-col lg:h-full lg:flex-row">
          <div className="min-w-0 lg:flex lg:h-full lg:flex-2 lg:flex-col">
            <div className="space-y-5 px-3 pt-2 pb-6 md:space-y-8 md:px-4 md:pt-6 lg:flex lg:flex-1 lg:flex-col lg:min-h-0 lg:pr-8">
              {isMobile && (
                <div className="mb-4 md:mb-6">
                  <Input
                    ref={titleInputRef}
                    value={detail.titleValue}
                    onChange={(e) => detail.setTitleValue(e.target.value)}
                    onBlur={detail.handleTitleBlur}
                    onKeyDown={detail.handleTitleKeyDown}
                    className="h-7 text-lg font-bold focus-visible:ring-0 md:h-10 md:text-2xl"
                    placeholder="Task title"
                  />
                </div>
              )}

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

              <TaskGithubExternalInfo taskId={taskId} />

              <TaskPullRequests taskId={taskId} />

              <TaskDependencies
                taskId={taskId}
                workspaceId={workspaceId}
              />

              <BacklinksDrawerTrigger resourceId={taskId} workspaceId={workspaceId} />

              <div className="space-y-2 animate-fade-in lg:flex lg:flex-1 lg:flex-col lg:min-h-0">
                <div className="flex items-center justify-between lg:shrink-0">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Description
                  </h3>
                  <div className="flex items-center gap-2 min-h-8">
                    {detail.awaitingSeed && <SeedingDescriptionNotice />}
                    {detail.editor && (
                      <TaskDescriptionSyncButton
                        taskId={taskId}
                        editor={detail.editor}
                      />
                    )}
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
                  workspaceId={workspaceId}
                  className="min-h-50 md:min-h-75 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                  hideLabel
                  loading={!detail.descriptionReady}
                />
              </div>
            </div>
          </div>

          {detail.currentUser && (
            <div className="min-w-0 border-t px-3 pt-6 pb-6 md:pl-6 md:pr-4 lg:flex lg:h-full lg:flex-1 lg:flex-col lg:border-t-0 lg:border-l lg:pt-6 lg:pb-6 lg:pl-8">
              <TaskActivityTimeline
                taskId={taskId}
                currentUserId={detail.currentUser._id}
                workspaceId={workspaceId}
                members={detail.members}
                fillHeight
              />
            </div>
          )}
        </div>
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
