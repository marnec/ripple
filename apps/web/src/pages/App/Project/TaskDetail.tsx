import { type CSSProperties, type ReactNode } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { TaskDetailContext, useTaskDetailContext } from "./taskDetailContext";
import { Input } from "@ripple/ui/components/input";
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
 * The task title input. Rendered up to three times across the two shells
 * (sheet header, page desktop toolbar, page mobile heading) — identical
 * wiring, different sizing, so only `className` varies.
 */
export function TaskTitleField({ className }: { className?: string }) {
  const detail = useTaskDetailContext();

  return (
    <Input
      value={detail.titleValue}
      onChange={(e) => detail.setTitleValue(e.target.value)}
      onBlur={detail.handleTitleBlur}
      onKeyDown={detail.handleTitleKeyDown}
      className={className}
      placeholder="Task title"
    />
  );
}

/**
 * Status / priority / assignee / tags / dates / estimate. Every control writes
 * through the module's single `patch`, so a failure in any of them surfaces
 * the same way.
 */
export function TaskPropertiesSection() {
  const detail = useLoadedTask();
  if (!detail || !detail.statuses || !detail.members) return null;
  const { task, patch } = detail;

  return (
    <TaskProperties
      task={task}
      statuses={detail.statuses}
      members={detail.members}
      onStatusChange={(statusId) => void patch({ statusId })}
      onPriorityChange={(priority) => void patch({ priority })}
      onAssigneeChange={(value) =>
        void patch({
          assigneeId: value === "unassigned" ? null : (value as Id<"users">),
        })
      }
      onSetTags={(labels) => void patch({ labels })}
      onRemoveTag={(tag) =>
        void patch({ labels: (task.labels ?? []).filter((t) => t !== tag) })
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
}) {
  const detail = useLoadedTask();
  if (!detail) return null;

  const editor = (
    <TaskDescriptionEditor
      editor={detail.editor}
      members={detail.members}
      workspaceId={detail.workspaceId}
      className={editorClassName}
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
            isConnected={detail.isConnected}
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
  collapsed,
  onToggle,
  toggleIcon,
}: {
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
      fillHeight
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
