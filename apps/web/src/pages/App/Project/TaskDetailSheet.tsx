import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@ripple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

// CSS-driven layout swap: animating `flex-grow` lets the two panels redistribute
// space without the scale/projection distortion framer-motion's `layout` causes
// on complex flex children (BlockNote editor, timeline list). flex-basis stays
// at 0 so the panel's allocated size is grow-driven only, not inflated by the
// editor/timeline's natural content height; the default `min-content` keeps
// the header visible when grow is 0.
const PANEL_TRANSITION_STYLE = {
  transition: "flex-grow 250ms cubic-bezier(0.16, 1, 0.3, 1)",
};

type TaskDetailSheetProps = {
  taskId: Id<"tasks"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

/**
 * Task detail as a side sheet over the board. This file is layout only — every
 * query, callback and load decision comes from the `TaskDetail` module, which
 * the full-page surface consumes the same way.
 */
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

  return (
    <TaskDetailProvider
      taskId={taskId}
      workspaceId={workspaceId}
      projectId={projectId}
      collaborationEnabled={editorDeferred}
    >
      <SheetShell
        taskId={taskId}
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        projectId={projectId}
        editorDeferred={editorDeferred}
      />
    </TaskDetailProvider>
  );
}

function SheetShell({
  taskId,
  open,
  onOpenChange,
  workspaceId,
  projectId,
  editorDeferred,
}: TaskDetailSheetProps & { editorDeferred: boolean }) {
  const detail = useTaskDetailContext();
  const navigate = useNavigate();

  // Description and Activity share the remaining vertical space in three states:
  // "shared" (default — both visible, splitting the space) and two solo states
  // where one is fully expanded and the other is reduced to its header. Clicking
  // a section toggles between "shared" and that section's solo state; clicking
  // either header from a solo state returns to "shared". Reset to "shared"
  // whenever the sheet switches to a different task — the previous task's
  // layout preference shouldn't carry over. Render-time reset (per the React
  // docs' "Resetting state when a prop changes" pattern) so the new state is
  // applied in the same render without an extra effect/commit pass.
  const [panelState, setPanelState] = useState<"shared" | "description" | "activity">("shared");
  const [panelStateTaskId, setPanelStateTaskId] = useState(taskId);
  if (panelStateTaskId !== taskId) {
    setPanelStateTaskId(taskId);
    setPanelState("shared");
  }
  // Each header cycles through all three states in a stable, predictable
  // order, prioritising its own section first. Earlier the buttons "toggled
  // to/from shared", which made clicks from a solo state feel unpredictable
  // (clicking the other section's header always landed back at shared,
  // never at the other solo state). No dominant UI pattern exists for this
  // shared/solo-A/solo-B vertical split, so we go with cycling.
  const toggleDescription = () =>
    setPanelState((s) =>
      s === "shared" ? "description" : s === "description" ? "activity" : "shared",
    );
  const toggleActivity = () =>
    setPanelState((s) =>
      s === "shared" ? "activity" : s === "activity" ? "description" : "shared",
    );

  // Defer activity timeline one frame after the editor
  const [showActivity, setShowActivity] = useState(false);
  useEffect(() => {
    if (!editorDeferred) return;
    const id = requestAnimationFrame(() => setShowActivity(true));
    return () => { cancelAnimationFrame(id); setShowActivity(false); };
  }, [editorDeferred]);

  const { task, loadState } = detail;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-full overflow-hidden outline-none"
          style={{ maxWidth: "44rem" }}
          finalFocus={false}
        >
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          {loadState === "loading" && (
            <div className="flex items-center justify-center py-12">
              <RippleSpinner />
            </div>
          )}
          {/* A task deleted while the sheet is open (by a collaborator, or in
              another tab) must not strand the sheet on a spinner — say so and
              let the user dismiss it. */}
          {loadState === "deleted" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">This task was deleted.</p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}
          {loadState === "ready" && task && (
            <>
              <SheetHeader className="shrink-0 pr-28 gap-3">
                <div className="flex items-center gap-2">
                  <TaskIdentity className="text-sm" />
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
                  <TaskTitleField className="text-lg font-semibold leading-none focus-visible:ring-0 px-2 h-full" />
                </div>
              </SheetHeader>

              <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 pb-4">
                {/* Fixed top region — task properties + GitHub info never scroll. */}
                <div className="shrink-0 space-y-5">
                  <TaskPropertiesSection />
                  <TaskGithubSection />
                </div>

                {/* Dependencies — collapsed by default to free vertical space. */}
                <div className="shrink-0">
                  <TaskDependenciesSection collapsible />
                </div>

                {/* Description / Activity arena — three layout states:
                    "shared" (both flex-grow:1, split remaining height),
                    "description" (description grows, activity → header only),
                    "activity" (activity grows, description → header only).
                    flex-shrink stays 0 so the collapsed panel keeps its header
                    height; flex-grow flips between 0 and 1 with a CSS
                    transition driving the size swap. */}
                <div className="flex-1 min-h-0 flex flex-col gap-3">
                  <TaskDescriptionSection
                    className="flex flex-col gap-2 min-w-0"
                    style={{
                      ...PANEL_TRANSITION_STYLE,
                      flexGrow: panelState === "activity" ? 0 : 1,
                      flexBasis: 0,
                    }}
                    headerClassName="gap-2 shrink-0"
                    heading={
                      <button
                        type="button"
                        onClick={toggleDescription}
                        title={
                          panelState === "description"
                            ? "Restore shared layout"
                            : panelState === "activity"
                              ? "Show description"
                              : "Expand description"
                        }
                        className="flex flex-1 items-center gap-1.5 -ml-1 rounded px-1 py-0.5 cursor-pointer hover:bg-muted/50"
                      >
                        {panelState === "description" ? (
                          <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <h3 className="text-sm font-semibold text-muted-foreground">
                          Description
                        </h3>
                      </button>
                    }
                    /* Toolbar stays mounted in all states so its min-h-8 keeps
                       the header row at a constant height — hiding it
                       conditionally caused the header (and therefore the whole
                       description block) to shift up when the activity panel
                       expanded. Opacity + pointer-events handle the visual hide. */
                    toolbarClassName={cn(
                      "transition-opacity duration-200",
                      panelState === "activity" && "opacity-0 pointer-events-none",
                    )}
                    /* Editor stays mounted in all states. `contain: size` on this
                       wrapper makes the browser size it as if empty, so the
                       editor's chrome + content do NOT contribute to the
                       section's min-content. Without this, BlockNote's intrinsic
                       size keeps the section at ~100px even with flex-grow: 0.
                       The editor still gets a real height from flex when
                       expanded; when collapsed the wrapper is 0 and
                       overflow-hidden clips the editor. */
                    editorWrapper={(editor) => (
                      <div
                        className="flex-1 min-h-0 overflow-hidden"
                        style={{ contain: "size" }}
                      >
                        {editor}
                      </div>
                    )}
                    editorClassName="h-full overflow-y-auto"
                  />

                  {/* Guarded on the viewer as well as the deferral: an empty
                      activity panel would still claim half the arena's height. */}
                  {showActivity && detail.currentUser && (
                    <div
                      style={{
                        ...PANEL_TRANSITION_STYLE,
                        flexGrow: panelState === "description" ? 0 : 1,
                        flexBasis: 0,
                      }}
                      className="flex flex-col min-w-0"
                    >
                      <TaskActivitySection
                        collapsed={panelState === "description"}
                        onToggle={toggleActivity}
                        toggleIcon={panelState === "activity" ? "minimize" : "maximize"}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {loadState === "ready" && (
        <TaskDeleteDialogSection onDeleted={() => onOpenChange(false)} />
      )}
    </>
  );
}
