import { type CSSProperties, type ReactNode } from "react";
import { Inbox, Link2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "convex-helpers/react/cache";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import type { Id } from "@convex/_generated/dataModel";
import { TaskDetailContext, useTaskDetailContext } from "./taskDetailContext";
import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuGroup,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuLabel,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
import { TaskCode } from "@/components/TaskCode";
import { cn } from "@/lib/utils";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { TaskDependencies } from "./TaskDependencies";
import { TaskDescriptionEditor } from "./TaskDescriptionEditor";
import { TaskDescriptionToolbar } from "./TaskDescriptionToolbar";
import { TaskGithubExternalInfo } from "./TaskGithubExternalInfo";
import { TaskIssueRef } from "./TaskIssueRef";
import { TaskProperties } from "./TaskProperties";
import { TaskSyncIndicator } from "./TaskSyncIndicator";
import { useTaskDetail } from "./useTaskDetail";

/**
 * The task-detail module: one owner of everything a task-detail surface does,
 * exposed as sections that a shell arranges in its own layout.
 *
 * Ripple shows the same task detail in two places — a side sheet over the
 * kanban board and a full page — and their layouts are genuinely different
 * (the sheet is one column with an animated description/activity split; the
 * page is a responsive two-column with a mobile header slot). What is *not*
 * different is the wiring: which query feeds which control, which callback
 * writes which field, what "loaded" means. That wiring used to be hand-copied
 * into both shells — 136 identical lines, 21 of 28 commits touching both — and
 * it had already drifted (a deleted task left the sheet spinning forever).
 *
 * So the split is: this module owns behaviour, the shells own layout. Sections
 * take `className` and presentational slots — never a `surface` flag. A flag
 * would put both layout trees in here behind branches, trading duplication for
 * conditional complexity.
 *
 * Pure decisions (load state, the write path and its failure copy) live in
 * `taskDetailModel.ts`, where they are unit-tested without a renderer.
 */

/**
 * A section that needs a loaded task. Sections are written against a non-null
 * task, and the shell decides what a loading/deleted surface looks like — so
 * this guard is a safety net for a section rendered outside the shell's own
 * `loadState` check, not the primary path.
 */
function useLoadedTask() {
  const detail = useTaskDetailContext();
  const { task, taskId } = detail;
  // Narrowed here once, so sections can read `task`/`taskId` without a
  // per-call-site null check.
  if (!task || !taskId) return null;
  return { ...detail, task, taskId };
}

export function TaskDetailProvider({
  taskId,
  workspaceId,
  projectId,
  collaborationEnabled,
  children,
}: {
  taskId: Id<"tasks"> | null;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  /** Defer the Yjs/PartyKit connection until true (e.g. once the sheet is visible). */
  collaborationEnabled?: boolean;
  children: ReactNode;
}) {
  const detail = useTaskDetail({
    taskId,
    workspaceId,
    projectId,
    collaborationEnabled,
  });

  return (
    <TaskDetailContext.Provider value={{ ...detail, taskId, workspaceId, projectId }}>
      {children}
    </TaskDetailContext.Provider>
  );
}

/** Task code + linked-issue chip + sync indicator — the task's identity row. */
export function TaskIdentity({ className }: { className?: string }) {
  const detail = useLoadedTask();
  if (!detail) return null;
  const ref = detail.task.externalRefs?.[0];

  return (
    <>
      <TaskCode task={detail.task} className={cn("shrink-0", className)} />
      <TaskIssueRef
        className={className}
        repoFullName={ref?.repoFullName}
        issueNumber={ref?.issueNumber}
        url={ref?.url}
        deleted={ref?.deleted}
        provider={ref?.provider}
      />
      <TaskSyncIndicator taskId={detail.task._id} />
    </>
  );
}

/**
 * The task title. A textarea that grows with its content (`field-sizing`), so
 * a long title wraps instead of being clipped by a one-line input — but it is
 * still a single line of data: Enter commits, and pasted newlines are folded
 * into spaces. Each shell sizes it through `className`.
 */
export function TaskTitleField({ className }: { className?: string }) {
  const detail = useTaskDetailContext();

  return (
    <textarea
      rows={1}
      value={detail.titleValue}
      onChange={(e) => detail.setTitleValue(e.target.value.replace(/\s*\n\s*/g, " "))}
      onBlur={detail.handleTitleBlur}
      onKeyDown={detail.handleTitleKeyDown}
      className={cn(
        "field-sizing-content w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 -mx-2 outline-none placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:bg-muted/40",
        className,
      )}
      placeholder="Task title"
      aria-label="Task title"
    />
  );
}

/**
 * The task's secondary actions — move to another cycle, copy link, delete —
 * behind one overflow button, so the destructive action is never the control
 * sitting next to the title. A drawer on mobile (via `ResponsiveDropdownMenu`).
 */
export function TaskActionsMenu({ size = "icon-sm" }: { size?: "icon" | "icon-sm" }) {
  const detail = useLoadedTask();
  if (!detail) return null;
  const { task, taskId, workspaceId } = detail;

  const copyLink = () => {
    const url = `${window.location.origin}/workspaces/${workspaceId}/projects/${task.projectId}/tasks/${taskId}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy the link"),
    );
  };

  return (
    <ResponsiveDropdownMenu>
      <ResponsiveDropdownMenuTrigger
        render={
          <Button variant="ghost" size={size} title="More actions" aria-label="More actions" />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </ResponsiveDropdownMenuTrigger>
      <ResponsiveDropdownMenuContent align="end" className="w-56">
        <TaskCycleMenuItems taskId={taskId} projectId={task.projectId} cycleId={task.cycleId} />
        <ResponsiveDropdownMenuItem onSelect={copyLink}>
          <Link2 className="text-muted-foreground" />
          <span>Copy link</span>
        </ResponsiveDropdownMenuItem>
        <ResponsiveDropdownMenuSeparator />
        <ResponsiveDropdownMenuItem
          variant="destructive"
          className="text-destructive"
          onSelect={() => detail.setShowDeleteDialog(true)}
        >
          <Trash2 className="text-destructive" />
          <span>Delete task</span>
        </ResponsiveDropdownMenuItem>
      </ResponsiveDropdownMenuContent>
    </ResponsiveDropdownMenu>
  );
}

/**
 * "Move to cycle" targets: the open cycles other than the task's own, plus the
 * backlog when the task is in a cycle — the same set the bulk action bar
 * offers. A flat labelled group rather than a submenu, because the menu is a
 * drawer on mobile and a drawer has no submenus. Renders nothing (separator
 * included) when there is nowhere to move to.
 */
function TaskCycleMenuItems({
  taskId,
  projectId,
  cycleId,
}: {
  taskId: Id<"tasks">;
  projectId: Id<"projects">;
  cycleId?: Id<"cycles">;
}) {
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const moveTasks = useMutation(api.cycles.moveTasks);
  const targets = (cycles ?? []).filter((c) => c.status === "open" && c._id !== cycleId);
  if (targets.length === 0 && !cycleId) return null;

  const move = (target: Id<"cycles"> | null) => {
    void moveTasks({ projectId, taskIds: [taskId], cycleId: target }).catch(
      (error: unknown) => toast.error(getErrorMessage(error, "Could not move the task")),
    );
  };

  return (
    <>
      {/* Base UI's GroupLabel must sit inside a Group. */}
      <ResponsiveDropdownMenuGroup>
        <ResponsiveDropdownMenuLabel>Move to cycle</ResponsiveDropdownMenuLabel>
        {targets.map((c) => (
          <ResponsiveDropdownMenuItem key={c._id} onSelect={() => move(c._id)}>
            <RefreshCw className="text-muted-foreground" />
            <span className="truncate">{c.name}</span>
            {c.isCurrent && <span className="ml-auto text-xs text-muted-foreground">current</span>}
          </ResponsiveDropdownMenuItem>
        ))}
        {cycleId && (
          <ResponsiveDropdownMenuItem onSelect={() => move(null)}>
            <Inbox className="text-muted-foreground" />
            <span>Backlog</span>
          </ResponsiveDropdownMenuItem>
        )}
      </ResponsiveDropdownMenuGroup>
      <ResponsiveDropdownMenuSeparator />
    </>
  );
}

/**
 * Status / priority / assignee / tags / dates / estimate. Every control writes
 * through the module's single `patch`, so a failure in any of them surfaces
 * the same way.
 */
export function TaskPropertiesSection({ collapsible }: { collapsible?: boolean }) {
  const detail = useLoadedTask();
  if (!detail || !detail.statuses || !detail.members) return null;
  const { task, patch } = detail;

  return (
    <TaskProperties
      // Keyed so view-local state (which optional rows the user added, the
      // details fold) resets when the sheet switches task.
      key={task._id}
      task={task}
      collapsible={collapsible}
      statuses={detail.statuses}
      members={detail.members}
      onStatusChange={(statusId) => void patch({ statusId })}
      onPriorityChange={(priority) => void patch({ priority })}
      onAssigneeChange={(value) =>
        void patch({
          assigneeId: value === "unassigned" ? null : (value as Id<"users">),
        })
      }
      onSetTags={(tags) => void patch({ tags })}
      onRemoveTag={(tag) =>
        void patch({ tags: (task.tags ?? []).filter((t) => t !== tag) })
      }
      onDueDateChange={(dueDate) => void patch({ dueDate })}
      onStartDateChange={(plannedStartDate) => void patch({ plannedStartDate })}
      onEstimateChange={(estimate) => void patch({ estimate })}
    />
  );
}

/** Provider-sourced "closed by" note. Renders nothing for a native task. */
export function TaskGithubSection() {
  const detail = useLoadedTask();
  if (!detail) return null;
  return <TaskGithubExternalInfo taskId={detail.taskId} />;
}

/** Blocked-by / blocks edges. */
export function TaskDependenciesSection({ collapsible }: { collapsible?: boolean }) {
  const detail = useLoadedTask();
  if (!detail) return null;
  return (
    <TaskDependencies
      taskId={detail.taskId}
      workspaceId={detail.workspaceId}
      collapsible={collapsible}
    />
  );
}

/**
 * The collaborative description: heading row (toolbar included) plus the
 * BlockNote editor.
 *
 * `heading` is a slot because the two shells disagree about it — the page uses
 * a static `<h3>`, the sheet a button that drives its expand/collapse split.
 * The toolbar and editor wiring underneath is identical and stays here.
 */
export function TaskDescriptionSection({
  heading,
  className,
  style,
  headerClassName,
  toolbarClassName,
  editorWrapper,
  editorClassName,
  editorScrollRef,
}: {
  heading: ReactNode;
  className?: string;
  /** Outer-box layout the shell owns — the sheet animates flex-grow here. */
  style?: CSSProperties;
  headerClassName?: string;
  toolbarClassName?: string;
  /** Wrap the editor — the sheet needs a `contain: size` box to collapse it. */
  editorWrapper?: (editor: ReactNode) => ReactNode;
  editorClassName?: string;
  /** Ref for the editor box, when the shell makes it the scroll container. */
  editorScrollRef?: (node: HTMLDivElement | null) => void;
}) {
  const detail = useLoadedTask();
  if (!detail) return null;

  const editor = (
    <TaskDescriptionEditor
      editor={detail.editor}
      members={detail.members}
      workspaceId={detail.workspaceId}
      className={editorClassName}
      scrollRef={editorScrollRef}
      hideLabel
      loading={!detail.descriptionReady}
      unavailableOffline={detail.unavailableOffline}
    />
  );

  return (
    <div className={className} style={style}>
      <div className={cn("flex items-center justify-between", headerClassName)}>
        {heading}
        <div className={toolbarClassName}>
          <TaskDescriptionToolbar
            taskId={detail.taskId}
            awaitingSeed={detail.awaitingSeed}
            provider={detail.linkedProvider}
            editor={detail.editor}
            sync={detail.sync}
            remoteUsers={detail.remoteUsers}
            currentUser={detail.currentUser}
          />
        </div>
      </div>
      {editorWrapper ? editorWrapper(editor) : editor}
    </div>
  );
}

/**
 * Activity + comments. Renders nothing until the viewer is known — the
 * timeline needs a current user to attribute comments to.
 */
export function TaskActivitySection({
  fillHeight,
  collapsed,
  onToggle,
  toggleIcon,
}: {
  /** Pin header + composer and scroll the list — needs a sized parent. */
  fillHeight?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  toggleIcon?: "maximize" | "minimize";
}) {
  const detail = useLoadedTask();
  if (!detail?.currentUser) return null;

  return (
    <TaskActivityTimeline
      taskId={detail.taskId}
      currentUserId={detail.currentUser._id}
      workspaceId={detail.workspaceId}
      members={detail.members}
      provider={detail.linkedProvider}
      isLinked={detail.isGithubLinked}
      fillHeight={fillHeight}
      collapsed={collapsed}
      onToggle={onToggle}
      toggleIcon={toggleIcon}
    />
  );
}

/**
 * The delete confirmation. `onDeleted` is the shell's business — the sheet
 * closes itself, the page navigates back to the project.
 */
export function TaskDeleteDialogSection({ onDeleted }: { onDeleted: () => void }) {
  const detail = useTaskDetailContext();

  return (
    <TaskDeleteDialog
      open={detail.showDeleteDialog}
      onOpenChange={detail.setShowDeleteDialog}
      isGithubLinked={detail.isGithubLinked}
      onConfirm={(closeGithubIssue) => detail.handleDelete(onDeleted, closeGithubIssue)}
    />
  );
}
