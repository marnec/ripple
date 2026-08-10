import { BacklinksButton } from "@/components/BacklinksDrawer";
import { RippleSpinner } from "@/components/RippleSpinner";
import { TagPickerButton } from "@/components/TagPickerButton";
import { Button } from "@ripple/ui/components/button";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import {
  TaskActivitySection,
  TaskDeleteDialogSection,
  TaskDependenciesSection,
  TaskDescriptionSection,
  TaskDetailProvider,
  TaskGithubSection,
  TaskIdentity,
  TaskPropertiesSection,
  TaskTitleField,
} from "./TaskDetail";
import { useTaskDetailContext } from "./taskDetailContext";
import { TaskGithubActions } from "./TaskGithubActions";

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

  return (
    <TaskDetailProvider
      taskId={taskId}
      workspaceId={workspaceId}
      projectId={projectId}
      collaborationEnabled={editorDeferred}
    >
      <PageShell workspaceId={workspaceId} projectId={projectId} taskId={taskId} />
    </TaskDetailProvider>
  );
}

/**
 * Task detail as a full page. This file is layout only — every query, callback
 * and load decision comes from the `TaskDetail` module, which the sheet
 * surface consumes the same way.
 */
function PageShell({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
}) {
  const detail = useTaskDetailContext();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  if (detail.loadState === "loading") {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (detail.loadState === "deleted" || !detail.task) {
    return <ResourceDeleted resourceType="task" />;
  }

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
            onChange={(labels) => void detail.patch({ labels })}
          />
          <TaskIdentity className="text-sm" />
          <TaskTitleField className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-lg font-semibold shadow-none focus-visible:ring-0" />
          <TaskGithubActions
            task={detail.task}
            projectId={projectId}
            workspaceId={workspaceId}
          />
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
                  <TaskTitleField className="h-7 text-lg font-bold focus-visible:ring-0 md:h-10 md:text-2xl" />
                </div>
              )}

              <TaskPropertiesSection />

              <TaskGithubSection />

              <TaskDependenciesSection collapsible />

              <BacklinksButton resourceId={taskId} workspaceId={workspaceId} />

              <TaskDescriptionSection
                className="space-y-2 animate-fade-in lg:flex lg:flex-1 lg:flex-col lg:min-h-0"
                headerClassName="lg:shrink-0"
                heading={
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Description
                  </h3>
                }
                editorClassName="min-h-50 md:min-h-75 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
              />
            </div>
          </div>

          {/* The timeline needs a viewer to attribute comments to; without one
              the whole column (and its border) stays out of the layout. */}
          {detail.currentUser && (
            <div className="min-w-0 border-t px-3 pt-6 pb-6 md:pl-6 md:pr-4 lg:flex lg:h-full lg:flex-1 lg:flex-col lg:border-t-0 lg:border-l lg:pt-6 lg:pb-6 lg:pl-8">
              <TaskActivitySection />
            </div>
          )}
        </div>
      </div>

      <TaskDeleteDialogSection
        onDeleted={() => {
          void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
        }}
      />
    </div>
  );
}
