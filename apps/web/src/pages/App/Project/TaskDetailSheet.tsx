import { RippleSpinner } from "@/components/RippleSpinner";
import { TaskCode } from "@/components/TaskCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ChevronRight, Maximize2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { TaskDescriptionToolbar } from "./TaskDescriptionToolbar";
import { TaskGithubExternalInfo } from "./TaskGithubExternalInfo";
import { TaskGithubActions } from "./TaskGithubActions";
import { TaskGithubIssueRef } from "./TaskGithubIssueRef";
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

  // Description and Activity share the remaining vertical space; exactly one is
  // expanded at a time (both benefit from height and aren't read together).
  const [openPanel, setOpenPanel] = useState<"description" | "activity">("description");

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
          className="w-full overflow-hidden outline-none"
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
                  <TaskCode task={task} className="text-sm"/>
                  <TaskGithubIssueRef
                    className="text-sm"
                    repoFullName={task.externalRefs?.[0]?.repoFullName}
                    issueNumber={task.externalRefs?.[0]?.issueNumber}
                    url={task.externalRefs?.[0]?.url}
                    deleted={task.externalRefs?.[0]?.deleted}
                    provider={task.externalRefs?.[0]?.provider}
                  />
                  <TaskSyncIndicator taskId={task._id} />
                  {/* Right-aligned action cluster, anchored clear of the
                      sheet's built-in close button. Flex so gaps close when the
                      GitHub affordances are absent (the common, native case). */}
                  <div className="absolute top-3 right-12 flex items-center gap-1">
                    <TaskGithubActions
                      task={task}
                      projectId={projectId}
                      workspaceId={workspaceId}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
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

              <div className="flex-1 min-h-0 flex flex-col gap-4 px-4 pb-4">
                {/* Fixed top region — task properties + GitHub info never scroll. */}
                <div className="shrink-0 space-y-5">
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
                </div>

                {/* Dependencies — collapsed by default to free vertical space. */}
                <div className="shrink-0">
                  <TaskDependencies
                    taskId={taskId}
                    workspaceId={workspaceId}
                    collapsible
                  />
                </div>

                {/* Description / Activity arena — they fight for the remaining
                    height; opening one collapses the other. Only the open
                    panel's body scrolls. */}
                <div className="flex-1 min-h-0 flex flex-col gap-3">
                  <div
                    className={cn(
                      "flex flex-col gap-2 min-w-0",
                      openPanel === "description" ? "flex-1 min-h-0" : "shrink-0",
                    )}
                  >
                    <div className="flex items-center justify-between shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPanel((p) =>
                            p === "description" ? "activity" : "description",
                          )
                        }
                        className="flex items-center gap-1.5 -ml-1 rounded px-1 py-0.5 hover:bg-muted/50"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 text-muted-foreground transition-transform",
                            openPanel === "description" && "rotate-90",
                          )}
                        />
                        <h3 className="text-sm font-semibold text-muted-foreground">
                          Description
                        </h3>
                      </button>
                      {openPanel === "description" && (
                        <TaskDescriptionToolbar
                          taskId={taskId}
                          awaitingSeed={detail.awaitingSeed}
                          editor={detail.editor}
                          isConnected={detail.isConnected}
                          remoteUsers={detail.remoteUsers}
                          currentUser={detail.currentUser}
                        />
                      )}
                    </div>
                    {/* Editor stays mounted while collapsed so Yjs sync keeps
                        running; only its view is hidden. */}
                    <TaskDescriptionEditor
                      editor={detail.editor}
                      documents={detail.documents}
                      diagrams={detail.diagrams}
                      spreadsheets={detail.spreadsheets}
                      members={detail.members}
                      workspaceId={workspaceId}
                      className={cn(
                        openPanel === "description"
                          ? "flex-1 min-h-0 overflow-y-auto"
                          : "hidden",
                      )}
                      hideLabel
                      loading={!detail.descriptionReady}
                    />
                  </div>

                  {detail.currentUser && showActivity && (
                    <div
                      className={cn(
                        "flex flex-col min-w-0",
                        openPanel === "activity" ? "flex-1 min-h-0" : "shrink-0",
                      )}
                    >
                      <TaskActivityTimeline
                        taskId={taskId}
                        currentUserId={detail.currentUser._id}
                        workspaceId={workspaceId}
                        members={detail.members}
                        fillHeight
                        collapsed={openPanel !== "activity"}
                        onToggle={() =>
                          setOpenPanel((p) =>
                            p === "activity" ? "description" : "activity",
                          )
                        }
                      />
                    </div>
                  )}
                </div>
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
