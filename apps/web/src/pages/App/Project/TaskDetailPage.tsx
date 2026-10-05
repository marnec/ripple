import { BacklinksButton } from "@/components/BacklinksDrawer";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@ripple/ui/components/button";
import { cn } from "@/lib/utils";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { LG_MEDIA_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useAutoHideScrollbar } from "@/hooks/use-autohide-scrollbar";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@ripple/ui/components/resizable";
import type { Id } from "@convex/_generated/dataModel";
import {
  TaskActionsMenu,
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
  const isWide = useMediaQuery(LG_MEDIA_QUERY);
  const activityRef = useRef<HTMLDivElement>(null);
  // Thumb shows while the description scrolls, as in the document editor.
  const descriptionScrollRef = useAutoHideScrollbar<HTMLDivElement>();

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

  const title = (
    <TaskTitleField className="text-xl font-semibold leading-snug md:text-2xl" />
  );
  // `bounded` (wide layout, where the panel is the page's height): the box
  // grows with its content from the same minimum as below lg until it reaches
  // the bottom of the panel, then scrolls inside itself — `min-h-0` lets the
  // section shrink to the space left under the title, while the box's own
  // min-height stops it shrinking past the minimum. Unbounded, it flows in
  // the single scrolling column.
  const description = (bounded: boolean) => (
    <TaskDescriptionSection
      className={cn(
        "space-y-2 animate-fade-in",
        bounded && "flex min-h-0 flex-col",
      )}
      headerClassName={bounded ? "shrink-0" : undefined}
      heading={
        <h3 className="text-sm font-semibold text-muted-foreground">
          Description
        </h3>
      }
      editorClassName={cn("min-h-50 md:min-h-75", bounded && "scrollbar-autohide")}
      editorScrollRef={bounded ? descriptionScrollRef : undefined}
    />
  );
  // Folded to the essentials in both layouts: below lg so the description
  // stays above the fold, from lg so the activity under it keeps its height.
  const details = (
    <div className="space-y-5">
      <TaskPropertiesSection collapsible />
      <TaskGithubSection />
      <TaskDependenciesSection collapsible />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Task toolbar — desktop only: identity, backlinks (in the toolbar, as
          on every other entity's `SurfaceHeader`) and actions. The title is
          not in here at any size; it heads the content column. On mobile the
          breadcrumb carries code + title and the rest moves to HeaderSlot. */}
      {!isMobile && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <TaskIdentity className="text-sm" />
          </div>
          <BacklinksButton resourceId={taskId} workspaceId={workspaceId} />
          <TaskGithubActions
            task={detail.task}
            projectId={projectId}
            workspaceId={workspaceId}
          />
          <TaskActionsMenu />
        </div>
      )}

      {isMobile && (
        <HeaderSlot>
          <BacklinksButton resourceId={taskId} workspaceId={workspaceId} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            aria-label="Jump to comments"
          >
            <MessageSquare className="size-4" />
          </Button>
          <TaskActionsMenu size="icon" />
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={detail.titleValue} />

      <div className="flex-1 min-h-0">
        {isWide ? (
          <WideLayout
            main={
              <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-8 px-8 py-6">
                <div className="shrink-0">{title}</div>
                {description(true)}
              </div>
            }
            details={details}
            activity={detail.currentUser && <TaskActivitySection fillHeight />}
          />
        ) : (
          // Single scrolling column, details folded to their essentials so
          // the description is above the fold on a phone.
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 pt-3 pb-8 md:px-6 md:pt-6">
              {title}
              {details}
              {description(false)}
              {/* The timeline needs a viewer to attribute comments to;
                  without one the block (and its divider) stays out. */}
              {detail.currentUser && (
                <div ref={activityRef} className="scroll-mt-4 border-t pt-6">
                  <TaskActivitySection />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <TaskDeleteDialogSection
        onDeleted={() => {
          void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
        }}
      />
    </div>
  );
}

/**
 * The lg+ layout: the description gets the main panel, and a resizable right
 * panel holds the details with the activity filling what is left under them.
 * Activity sits beside the description, not below it, so on a long-running
 * task the comments are where you land rather than past a long description —
 * and the two can be read side by side. The right panel's width is the
 * user's, remembered across tasks.
 */
function WideLayout({
  main,
  details,
  activity,
}: {
  main: ReactNode;
  details: ReactNode;
  activity: ReactNode;
}) {
  const layout = useDefaultLayout({ id: "task-detail-panels" });

  return (
    <ResizablePanelGroup
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {/* Not a scroll container: the title stays put and the description's
          editor box scrolls once it has grown to the bottom of the panel. */}
      <ResizablePanel id="main" minSize="40%">
        {main}
      </ResizablePanel>
      <ResizableHandle withHandle />
      {/* Pixel sizes (numbers): the panel's job is to fit a comment thread,
          which needs a width in px, not a share of the window. */}
      <ResizablePanel id="side" defaultSize={384} minSize={320} maxSize="60%">
        <div className="flex h-full flex-col">
          {/* Capped so an expanded "More details" can't squeeze the activity
              out; past the cap the details scroll on their own. */}
          <div className="max-h-[50%] shrink-0 overflow-y-auto border-b px-5 pt-5 pb-4">
            {details}
          </div>
          {activity && <div className="min-h-0 flex-1 px-5 py-4">{activity}</div>}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
