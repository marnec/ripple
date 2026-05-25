import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatTaskId } from "@/lib/task-utils";
import { getUserColor } from "@/lib/user-colors";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import { ExternalLink, Maximize2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { SeedingDescriptionNotice } from "./SeedingDescriptionNotice";
import { TaskDescriptionSyncButton } from "./TaskDescriptionSyncButton";
import { TaskGithubDeletedIndicator } from "./TaskGithubDeletedIndicator";
import { TaskGithubExternalInfo } from "./TaskGithubExternalInfo";
import { TaskPullRequests } from "./TaskPullRequests";
import { TaskProperties } from "./TaskProperties";
import { TaskSyncIndicator } from "./TaskSyncIndicator";
import { useTaskDetail } from "./useTaskDetail";

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
  // Defer editor creation so the first render (sheet mount + animation start)
  // is not blocked by useCreateBlockNote's synchronous ProseMirror init (~233ms).
  // The Yjs provider + IndexedDB still load in the background; only the heavy
  // editor instantiation is pushed to the next frame.
  const [editorDeferred, setEditorDeferred] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setEditorDeferred(true));
    return () => { cancelAnimationFrame(id); setEditorDeferred(false); };
  }, [open]);

  const { titleInputRef, ...detail } = useTaskDetail({
    taskId,
    workspaceId,
    projectId,
    collaborationEnabled: editorDeferred,
    suggestionDataEnabled: open,
  });
  const navigate = useNavigate();

  // Defer activity timeline one frame after the editor
  const [showActivity, setShowActivity] = useState(false);
  useEffect(() => {
    if (!editorDeferred) return;
    const id = requestAnimationFrame(() => setShowActivity(true));
    return () => { cancelAnimationFrame(id); setShowActivity(false); };
  }, [editorDeferred]);

  const { task } = detail;
  const isLoaded = !!taskId && !!task && detail.statuses !== undefined && detail.members !== undefined;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-full overflow-hidden scrollbar-stable outline-none"
          style={{ maxWidth: "44rem" }}
          finalFocus={false}
        >
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          {!isLoaded || !task ? (
            <div className="flex items-center justify-center py-12">
              <RippleSpinner />
            </div>
          ) : (
            <>
              <SheetHeader className="shrink-0 pr-28 gap-3">
                <div className="flex items-center gap-2">
                  {(() => {
                    const taskIdStr = formatTaskId(task.projectKey, task.number);
                    return taskIdStr ? (
                      <span className="text-xs text-muted-foreground font-mono">
                        {taskIdStr}
                      </span>
                    ) : null;
                  })()}
                  <TaskSyncIndicator taskId={task._id} />
                  <TaskGithubDeletedIndicator
                    taskId={task._id}
                    className="absolute top-5 right-28"
                  />
                  {(() => {
                    const issueUrl = task.externalRefs?.[0]?.url;
                    return (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-3 right-20"
                        disabled={!issueUrl}
                        onClick={() =>
                          issueUrl &&
                          window.open(issueUrl, "_blank", "noopener,noreferrer")
                        }
                        title={
                          issueUrl
                            ? "Open linked issue on GitHub"
                            : "No linked issue"
                        }
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    );
                  })()}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-3 right-12"
                    onClick={() =>
                      void navigate(
                        `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`
                      )
                    }
                    title="Expand to full page"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1 h-7">
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
                    className="text-lg font-semibold leading-none focus-visible:ring-0 px-2 h-full"
                    placeholder="Task title"
                  />
                </div>
              </SheetHeader>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-5 px-4 pb-4">
                <TaskProperties
                  task={task}
                  statuses={detail.statuses!}
                  members={detail.members!}
                  onStatusChange={detail.handleStatusChange}
                  onPriorityChange={detail.handlePriorityChange}
                  onAssigneeChange={detail.handleAssigneeChange}
                  onSetTags={detail.handleSetTags}
                  onRemoveTag={detail.handleRemoveTag}
                  onDueDateChange={detail.handleDueDateChange}
                  onStartDateChange={detail.handlePlannedStartDateChange}
                  onEstimateChange={detail.handleEstimateChange}
                />

                <TaskGithubExternalInfo taskId={task._id} />

                <TaskPullRequests taskId={task._id} />

                <TaskDependencies
                  taskId={taskId}
                  workspaceId={workspaceId}
                />

                <div className="space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between">
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
                    className="min-h-50"
                    hideLabel
                    loading={!detail.descriptionReady}
                  />
                </div>

                {detail.currentUser && showActivity && (
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
            </>
          )}
        </SheetContent>
      </Sheet>

      {isLoaded && (
        <TaskDeleteDialog
          open={detail.showDeleteDialog}
          onOpenChange={detail.setShowDeleteDialog}
          isGithubLinked={detail.isGithubLinked}
          onConfirm={(closeGithubIssue) =>
            detail.handleDelete(() => onOpenChange(false), closeGithubIssue)
          }
        />
      )}
    </>
  );
}
