import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@ripple/ui/components/button";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/contexts/ShortcutsContext";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { LG_MEDIA_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useAutoHideScrollbar } from "@/hooks/use-autohide-scrollbar";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { Eye, FileText, MessageSquare, Minimize2, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { sheetReturnHref, type TaskPageLocationState } from "./taskSheetParam";
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
  const location = useLocation();
  const isMobile = useIsMobile();
  const isWide = useMediaQuery(LG_MEDIA_QUERY);
  // A phone shows the description or the activity, never both stacked: the
  // header's comment button switches between them (see the HeaderSlot below).
  const [mobilePanel, setMobilePanel] = useState<"description" | "activity">("description");
  // A phone opens the description read-only, so scrolling a long one never
  // drops a caret and raises the keyboard. Editing is a deliberate switch.
  const [descriptionEditable, setDescriptionEditable] = useState(false);
  // Thumb shows while the description scrolls, as in the document editor.
  const descriptionScrollRef = useAutoHideScrollbar<HTMLDivElement>();

  const ready = detail.loadState === "ready";
  // The sheet's "expand" in reverse: back to the surface it was expanded from
  // (or the project's tasks), this task open in its sheet.
  const openInSheet = () =>
    void navigate(
      sheetReturnHref({
        returnTo: (location.state as TaskPageLocationState | null)?.sheetReturnTo,
        workspaceId,
        projectId,
        taskId,
      }),
    );
  const sheetRef = useShortcut("expand", openInSheet, {
    enabled: ready && !isMobile,
    label: "Open in side sheet",
  });
  // The sheet's Mod+⇧V, where this page also shows one panel at a time.
  useShortcut(
    "toggleView",
    () => setMobilePanel((p) => (p === "description" ? "activity" : "description")),
    { enabled: ready && isMobile && Boolean(detail.currentUser), label: "Description / activity" },
  );

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
  // takes every pixel left under the context section and scrolls inside
  // itself — `contain: size` keeps BlockNote's intrinsic height out of the
  // column's min-content, so flex alone sizes it (as on a phone). Unbounded,
  // it flows in the single scrolling column.
  const description = (bounded: boolean) => (
    <TaskDescriptionSection
      className={cn(
        "space-y-2 animate-fade-in",
        bounded && "flex min-h-75 flex-1 flex-col",
      )}
      headerClassName={bounded ? "shrink-0" : undefined}
      heading={descriptionHeading}
      editorWrapper={
        bounded
          ? (editor) => (
              <div className="min-h-0 flex-1 overflow-hidden" style={{ contain: "size" }}>
                {editor}
              </div>
            )
          : undefined
      }
      editorClassName={bounded ? "h-full overflow-y-auto scrollbar-autohide" : "min-h-50 md:min-h-75"}
      editorScrollRef={bounded ? descriptionScrollRef : undefined}
    />
  );
  // Status, priority and assignee rows, then one line of time and dependency
  // chips — nothing folded. On a phone the whole block is pills.
  const details = (
    <div className="space-y-5">
      <TaskPropertiesSection layout="page" />
      <TaskGithubSection />
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
          <Button
            ref={sheetRef}
            variant="ghost"
            size="icon-sm"
            onClick={openInSheet}
            title="Open in side sheet"
            aria-label="Open in side sheet"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
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
              // `pb-4` is the side panel's: the description box and the
              // comment composer end on one line.
              <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 px-8 pt-6 pb-4">
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
                // Flush right, after the presence avatars and their size:
                // under the thumb. The icon is the current mode — viewing
                // or editing — not the action.
                toolbarTrailing={
                  <button
                    type="button"
                    onClick={() => setDescriptionEditable((e) => !e)}
                    aria-pressed={descriptionEditable}
                    aria-label={descriptionEditable ? "Editing description" : "Viewing description"}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      descriptionEditable
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {descriptionEditable ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
                readOnly={!descriptionEditable}
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
 * The phone layout: the page is the viewport's height, never a scroller. The
 * property pills sit on top (capped, scrolling on their own past the cap, so
 * a wrapped pill row or a long GitHub note cannot squeeze the body out);
 * below, one panel takes
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
          {/* Capped so a long GitHub note or wrapped chip rows can't squeeze
              the activity out; past the cap the details scroll on their own. */}
          <div className="max-h-[50%] shrink-0 overflow-y-auto border-b px-5 pt-5 pb-4">
            {details}
          </div>
          {activity && <div className="min-h-0 flex-1 px-5 py-4">{activity}</div>}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
