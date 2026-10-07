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
import { FileText, MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
  TaskTagPicker,
  TaskTagStrip,
  TaskTitleInline,
} from "./TaskDetail";
import { useTaskDetailContext } from "./taskDetailContext";
import { TaskContext } from "./TaskContext";
import { TaskGithubActions } from "./TaskGithubActions";
import { SafeAreaSpacer } from "@/components/SafeAreaSpacer";

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
  // A phone shows the description or the activity, never both stacked: the
  // header's comment button switches between them (see the HeaderSlot below).
  const [mobilePanel, setMobilePanel] = useState<"description" | "activity">("description");
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

  const descriptionHeading = (
    <h3 className="text-sm font-semibold text-muted-foreground">Description</h3>
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
      heading={descriptionHeading}
      editorClassName={cn("min-h-50 md:min-h-75", bounded && "scrollbar-autohide")}
      editorScrollRef={bounded ? descriptionScrollRef : undefined}
    />
  );
  // Folded to the essentials in both layouts: below lg so the description
  // stays above the fold, from lg so the activity under it keeps its height.
  const details = (
    <div className="space-y-5">
      <TaskPropertiesSection collapsible hideTags />
      <TaskGithubSection />
      {/* On a phone dependencies are a chip among the property pills. */}
      {!isMobile && <TaskDependenciesSection collapsible />}
    </div>
  );

  // What points at this task, with the local graph to its right. Desktop
  // only: on a phone references are a chip among the property pills, and the
  // title is the header's (tap to rename), so the column starts at the pills.
  // Page-only: the sheet keeps the backlinks drawer, it has no room for a
  // canvas.
  const context = isMobile ? null : (
    <TaskContext taskId={taskId} workspaceId={workspaceId} className="shrink-0" />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Task toolbar — desktop only: identity, title and actions, like every
          other entity's `SurfaceHeader` — but no backlinks toggle: on desktop
          a task's references are its Context section (on mobile, a chip among
          the property pills).
          On mobile the header's title is the title — tap it to rename — and
          the rest moves to HeaderSlot. */}
      {!isMobile && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {/* Same order as `SurfaceHeader`: tag picker, name, tag strip — the
              task's identity chips lead its name. The name shrinks first. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <TaskTagPicker />
            <TaskIdentity className="text-sm" />
            {/* Takes every pixel the chips leave, and keeps clear of them. */}
            <h1 className="mx-2 flex min-w-0 flex-1 text-lg font-semibold">
              <TaskTitleInline fill />
            </h1>
            <TaskTagStrip />
          </div>
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
          {/* Tags and references live in the property pills on a phone
              (`TaskPropertyPills`), leaving the header to the title. */}
          {/* Switches the body between description and activity. The icon is
              the panel it leads to; without a viewer there is no activity. */}
          {detail.currentUser && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setMobilePanel((p) => (p === "description" ? "activity" : "description"));
              }}
              aria-label={mobilePanel === "description" ? "Show activity" : "Show description"}
            >
              {mobilePanel === "description" ? (
                <MessageSquare className="size-4" />
              ) : (
                <FileText className="size-4" />
              )}
            </Button>
          )}
          <TaskActionsMenu size="icon" />
        </HeaderSlot>
      )}
      <MobileHeaderTitle
        name={detail.task.title}
        onRename={(title) => detail.patch({ title })}
        resourceLabel="task"
      />

      <div className="flex-1 min-h-0">
        {isWide ? (
          <WideLayout
            main={
              <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-8 px-8 py-6">
                {context}
                {description(true)}
              </div>
            }
            details={details}
            activity={detail.currentUser && <TaskActivitySection fillHeight />}
          />
        ) : isMobile ? (
          <MobileLayout
            head={details}
            panel={detail.currentUser ? mobilePanel : "description"}
            description={
              <TaskDescriptionSection
                className="flex min-h-0 flex-1 flex-col gap-2"
                headerClassName="shrink-0"
                heading={descriptionHeading}
                // `contain: size` keeps BlockNote's intrinsic height out of
                // the column's min-content, so flex alone sizes the box and
                // the editor scrolls inside it (as in the sheet).
                editorWrapper={(editor) => (
                  <div className="min-h-0 flex-1 overflow-hidden" style={{ contain: "size" }}>
                    {editor}
                  </div>
                )}
                editorClassName="h-full overflow-y-auto scrollbar-autohide"
              />
            }
            activity={<TaskActivitySection fillHeight />}
          />
        ) : (
          // Single scrolling column, details folded to their essentials, with
          // the description and then the activity stacked under them.
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-6 pb-8">
              {context}
              {details}
              {description(false)}
              {/* The timeline needs a viewer to attribute comments to;
                  without one the block (and its divider) stays out. */}
              {detail.currentUser && (
                <div className="border-t pt-6">
                  <TaskActivitySection />
                </div>
              )}
            </div>
            <SafeAreaSpacer />
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
 * The phone layout: the page is the viewport's height, never a scroller. Title
 * and details sit on top (capped, scrolling on their own past the cap, so an
 * expanded "More details" cannot squeeze the body out); below, one panel takes
 * every pixel left. The description editor scrolls inside its box; the
 * activity scrolls its list and keeps the composer pinned to the bottom.
 *
 * The description stays mounted while hidden — it is a live editor (BlockNote
 * over Yjs) and rebuilding it on every switch would be the slow part. The
 * activity mounts when shown: its query is cached, and mounting is what lands
 * the list on the newest entry (a `display: none` list has no height to
 * scroll to the end of).
 */
function MobileLayout({
  head,
  panel,
  description,
  activity,
}: {
  head: ReactNode;
  panel: "description" | "activity";
  description: ReactNode;
  activity: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[45%] shrink-0 space-y-6 overflow-y-auto px-3 pt-3 pb-4">
        {head}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col px-3 pb-3", panel !== "description" && "hidden")}>
        {description}
      </div>
      {panel === "activity" && (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">{activity}</div>
      )}
      <SafeAreaSpacer />
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
