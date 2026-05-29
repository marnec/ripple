import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isBlocksEmpty, parseCommentBody } from "@/lib/editor-utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import {
  ArrowRight,
  CircleDot,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Link2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Type,
  UserRound,
  Calendar,
  Clock,
  Gauge,
  FileText,
  Minus,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { SuggestionMenuController } from "@blocknote/react";
import { taskCommentSchema } from "./taskCommentSchema";
import { useTheme } from "next-themes";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { StaticCommentBody } from "./StaticCommentBody";
import { GithubMark } from "@/components/GithubMark";
import { GitlabMark } from "@/components/GitlabMark";
import { cn } from "@/lib/utils";
import type { EditCommentEditorProps, WorkspaceMemberSummary } from "./comment-types";

type TimelineFilter = "all" | "comments" | "integration";

type TaskActivityTimelineProps = {
  taskId: Id<"tasks">;
  currentUserId: Id<"users">;
  workspaceId: Id<"workspaces">;
  /** Pre-fetched workspace members — avoids a duplicate query when parent already has them. */
  members?: WorkspaceMemberSummary[];
  /** Provider of the task's integration link ("github" or "gitlab"), drives
   *  provider-aware labels on integration-sourced events. Defaults to
   *  "github" — safe for Ripple-native tasks (the integration labels never
   *  appear for them). */
  provider?: string;
  /** On lg+, pin header & composer and scroll only the list. Requires a parent with a defined height. */
  fillHeight?: boolean;
  /** When set, the header becomes a click target and renders the toggle icon. */
  onToggle?: () => void;
  /** Whether the timeline body is collapsed to just its header. Only meaningful with `onToggle`. */
  collapsed?: boolean;
  /** Which icon to render in the header toggle button when `onToggle` is set.
   *  "maximize" means clicking grows this section (from shared/collapsed),
   *  "minimize" means clicking returns to the shared layout. */
  toggleIcon?: "maximize" | "minimize";
};

type TimelineItem = {
  kind: "activity" | "comment";
  _id: string;
  _creationTime: number;
  userId: string;
  userName: string;
  userImage?: string;
  // activity fields
  type?: string;
  oldValue?: string;
  newValue?: string;
  /** "integration" for GitHub-driven events; absent/"local" for user actions. */
  source?: "local" | "integration";
  // comment fields
  commentId?: string;
  body?: string;
  externalAuthor?: { login: string; avatarUrl: string; url: string };
};


function formatRelativeTimestamp(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(ts);
  const nowD = new Date(now);
  const sameYear = d.getFullYear() === nowD.getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" });
  return sameYear
    ? `${month} ${d.getDate()}`
    : `${month} ${d.getDate()}, ${String(d.getFullYear()).slice(2)}`;
}

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? "GitHub";
}

function getActivityIcon(type: string, provider: string) {
  switch (type) {
    case "created": return <Plus className="h-3 w-3" />;
    case "status_change": return <CircleDot className="h-3 w-3" />;
    case "priority_change": return <Gauge className="h-3 w-3" />;
    case "assignee_change": return <UserRound className="h-3 w-3" />;
    case "label_add": return <Tag className="h-3 w-3" />;
    case "label_remove": return <Tag className="h-3 w-3" />;
    case "title_change": return <Type className="h-3 w-3" />;
    case "due_date_change": return <Calendar className="h-3 w-3" />;
    case "start_date_change": return <Calendar className="h-3 w-3" />;
    case "estimate_change": return <Clock className="h-3 w-3" />;
    case "dependency_add": return <Link2 className="h-3 w-3" />;
    case "dependency_remove": return <Link2 className="h-3 w-3" />;
    case "comment_edit": return <Pencil className="h-3 w-3" />;
    case "comment_delete": return <Trash2 className="h-3 w-3" />;
    // Integration events
    case "pr_linked": return <GitPullRequest className="h-3 w-3" />;
    case "pr_unlinked": return <GitPullRequest className="h-3 w-3" />;
    case "pr_merged": return <GitMerge className="h-3 w-3" />;
    case "pr_closed": return <GitPullRequestClosed className="h-3 w-3" />;
    case "branch_created": return <GitBranch className="h-3 w-3" />;
    case "status_synced": return <CircleDot className="h-3 w-3" />;
    case "description_synced": return <FileText className="h-3 w-3" />;
    case "issue_linked":
    case "issue_created": {
      const Mark = provider === "gitlab" ? GitlabMark : GithubMark;
      return <Mark className="h-3 w-3" />;
    }
    default: return <Minus className="h-3 w-3" />;
  }
}

function getActivityDescription(item: TimelineItem, provider: string): React.ReactNode {
  const { type, oldValue, newValue, userName } = item;

  switch (type) {
    case "created":
      return <><span className="font-medium">{userName}</span> created this task</>;
    case "status_change":
      return <><span className="font-medium">{userName}</span> changed status from <span className="font-medium">{oldValue}</span> <ArrowRight className="inline h-3 w-3 mx-0.5" /> <span className="font-medium">{newValue}</span></>;
    case "priority_change":
      return <><span className="font-medium">{userName}</span> changed priority from <span className="font-medium">{oldValue}</span> <ArrowRight className="inline h-3 w-3 mx-0.5" /> <span className="font-medium">{newValue}</span></>;
    case "assignee_change":
      if (!oldValue && newValue) return <><span className="font-medium">{userName}</span> assigned to <span className="font-medium">{newValue}</span></>;
      if (oldValue && !newValue) return <><span className="font-medium">{userName}</span> unassigned <span className="font-medium">{oldValue}</span></>;
      return <><span className="font-medium">{userName}</span> reassigned from <span className="font-medium">{oldValue}</span> <ArrowRight className="inline h-3 w-3 mx-0.5" /> <span className="font-medium">{newValue}</span></>;
    case "label_add":
      return <><span className="font-medium">{userName}</span> added tag <span className="font-medium">{newValue}</span></>;
    case "label_remove":
      return <><span className="font-medium">{userName}</span> removed tag <span className="font-medium">{oldValue}</span></>;
    case "title_change":
      return <><span className="font-medium">{userName}</span> renamed from &ldquo;{oldValue}&rdquo; to &ldquo;{newValue}&rdquo;</>;
    case "due_date_change":
      if (!newValue) return <><span className="font-medium">{userName}</span> removed due date</>;
      return <><span className="font-medium">{userName}</span> set due date to <span className="font-medium">{newValue}</span></>;
    case "start_date_change":
      if (!newValue) return <><span className="font-medium">{userName}</span> removed start date</>;
      return <><span className="font-medium">{userName}</span> set start date to <span className="font-medium">{newValue}</span></>;
    case "estimate_change":
      if (!newValue) return <><span className="font-medium">{userName}</span> removed estimate</>;
      return <><span className="font-medium">{userName}</span> set estimate to <span className="font-medium">{newValue}h</span></>;
    case "dependency_add": {
      const [depType, target] = (newValue ?? ":").split(":");
      const label = depType === "blocks" ? "blocking" : "related to";
      return <><span className="font-medium">{userName}</span> added {label} dependency on <span className="font-medium">{target}</span></>;
    }
    case "dependency_remove": {
      const [depType, target] = (oldValue ?? ":").split(":");
      const label = depType === "blocks" ? "blocking" : "related to";
      return <><span className="font-medium">{userName}</span> removed {label} dependency on <span className="font-medium">{target}</span></>;
    }
    case "comment_edit":
      return <><span className="font-medium">{userName}</span> edited a comment</>;
    case "comment_delete":
      return <><span className="font-medium">{userName}</span> deleted a comment</>;
    // Integration events — passive voice: the actor is the integration bot, not
    // a Ripple user, so attributing a name would be misleading. Provider label
    // is threaded through so GitLab tasks read "Imported from GitLab issue …"
    // instead of "GitHub" (the default before the GitLab integration shipped).
    case "issue_linked":
      return <>Imported from {providerLabel(provider)} issue <span className="font-medium">{newValue}</span></>;
    case "issue_created":
      return <>Created {providerLabel(provider)} issue <span className="font-medium">{newValue}</span></>;
    case "branch_created":
      return <>Created branch <span className="font-medium">{newValue}</span></>;
    case "pr_linked":
      return <>Linked pull request <span className="font-medium">{newValue}</span></>;
    case "pr_unlinked":
      return <>Unlinked pull request <span className="font-medium">{oldValue}</span></>;
    case "pr_merged":
      return <>Merged pull request <span className="font-medium">{newValue}</span></>;
    case "pr_closed":
      return <>Closed pull request <span className="font-medium">{newValue}</span></>;
    case "status_synced":
      return <>Status synced from <span className="font-medium">{oldValue}</span> <ArrowRight className="inline h-3 w-3 mx-0.5" /> <span className="font-medium">{newValue}</span></>;
    case "description_synced":
      return <>Synced description to {providerLabel(provider)}</>;
    default:
      return <><span className="font-medium">{userName}</span> made a change</>;
  }
}

export function TaskActivityTimeline({ taskId, currentUserId, workspaceId, members: membersProp, provider = "github", fillHeight = false, onToggle, collapsed = false, toggleIcon = "maximize" }: TaskActivityTimelineProps) {
  const timeline = useQuery(api.taskActivity.timeline, { taskId });
  // Use pre-fetched members when available; fall back to workspace context
  const contextMembers = useWorkspaceMembers();
  const workspaceMembers = membersProp ?? contextMembers;
  const createComment = useMutation(api.taskComments.create);
  const updateComment = useMutation(api.taskComments.update);
  const removeComment = useMutation(api.taskComments.remove);

  const fileUpload = useUploadFile(workspaceId);
  const uploadFile = fileUpload?.uploadFile;

  const [filter, setFilter] = useState<TimelineFilter>("comments");
  const [editingCommentId, setEditingCommentId] = useState<Id<"taskComments"> | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const { resolvedTheme } = useTheme();

  const editor = useCreateBlockNote({
    schema: taskCommentSchema,
    uploadFile,
  });

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
  });

  const handleSubmit = () => {
    if (isBlocksEmpty(editor.document)) return;
    const body = JSON.stringify(editor.document);
    // Render to markdown for the GitHub push (lossy for mentions, like the
    // description sync). Stored body stays BlockNote JSON for Ripple rendering.
    const bodyMarkdown = editor.blocksToMarkdownLossy(editor.document);
    void createComment({ taskId, body, bodyMarkdown }).then(() => {
      editor.replaceBlocks(editor.document, [{ id: crypto.randomUUID(), type: "paragraph", content: "" }]);
      setIsEmpty(true);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDelete = (commentId: Id<"taskComments">) => {
    void removeComment({ id: commentId });
  };

  const filteredItems = timeline === undefined
    ? []
    : filter === "comments"
      ? timeline.filter((item: TimelineItem) => item.kind === "comment")
      : filter === "integration"
        ? timeline.filter(
            (item: TimelineItem) =>
              item.kind === "activity" && item.source === "integration",
          )
        : timeline;

  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!fillHeight || filter !== "all") return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [fillHeight, filter, filteredItems.length]);

  if (timeline === undefined || workspaceMembers === undefined) {
    return null;
  }

  return (
    <div
      className={
        fillHeight
          ? "animate-fade-in space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:space-y-0"
          : "animate-fade-in space-y-4"
      }
    >
      {/* Header with filter */}
      <div
        className={cn(
          "flex items-center justify-between",
          fillHeight && "lg:mb-3 lg:shrink-0",
          fillHeight && !collapsed && "lg:border-b lg:pb-3",
        )}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            title={
              toggleIcon === "minimize"
                ? "Restore shared layout"
                : collapsed
                  ? "Show activity"
                  : "Expand activity"
            }
            className="flex items-center gap-1.5 -ml-1 rounded px-1 py-0.5 hover:bg-muted/50"
          >
            {toggleIcon === "minimize" ? (
              <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold text-muted-foreground">Activity</h3>
          </button>
        ) : (
          <h3 className="text-sm font-semibold text-muted-foreground">Activity</h3>
        )}
        {!collapsed && (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
            <TabsList className="h-7">
              <TabsTrigger value="comments" className="text-xs px-2 py-0.5">Comments</TabsTrigger>
              <TabsTrigger value="integration" className="text-xs px-2 py-0.5">Integration</TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-2 py-0.5">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Body wrapper — stays mounted in all states so the parent panel's
          flex-grow transition can animate without React remounting heavy
          content mid-transition. `contain: size` (fillHeight only) makes
          the wrapper's intrinsic size 0, so the body content can't inflate
          the parent panel's min-content; the panel can therefore collapse
          cleanly to just its header when the section isn't expanded.
          When collapsed, the wrapper has 0 allocated height and its
          overflow-hidden clips the body. */}
      <div
        className={
          fillHeight
            ? "space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden lg:contain-[size]"
            : collapsed
              ? "hidden"
              : "space-y-4"
        }
      >
      {/* Timeline items with connector line */}
      <div
        ref={listRef}
        className={
          fillHeight
            ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
            : ""
        }
      >
        {/* Integration tab leads with a live PR summary (renders nothing when
            the task has no linked PRs), then the chronological event log. */}
        {/* {filter === "integration" && (
          <div className="mb-3">
            <TaskPullRequests taskId={taskId} />
          </div>
        )} */}
        <div className="relative">
          {/* Vertical connector line — sits inside the content box so it spans full scroll height. */}
          {filteredItems.length > 1 && (
            <div className="absolute left-3 top-3 bottom-3 -ml-px w-px bg-border" />
          )}
          <div className="space-y-1">
            {filteredItems.length === 0 ? (
              filter === "comments" ? null : (
                <p className="text-sm text-muted-foreground">
                  {filter === "integration"
                    ? "No integration activity yet"
                    : "No activity yet"}
                </p>
              )
            ) : (
              filteredItems.map((item: TimelineItem) =>
                item.kind === "comment" ? (
                  <CommentItem
                    key={item._id}
                    item={item}
                    currentUserId={currentUserId}
                    editingCommentId={editingCommentId}
                    workspaceMembers={workspaceMembers}
                    workspaceId={workspaceId}
                    uploadFile={uploadFile}
                    onEdit={setEditingCommentId}
                    onDelete={handleDelete}
                    onSave={(id, body, bodyMarkdown) => {
                      void updateComment({ id, body, bodyMarkdown }).then(() => {
                        setEditingCommentId(null);
                      });
                    }}
                    onCancelEdit={() => setEditingCommentId(null)}
                  />
                ) : (
                  <ActivityItem key={item._id} item={item} provider={provider} />
                )
              )
            )}
          </div>
        </div>
      </div>

      {/* Comment input */}
      <div
        className={
          fillHeight
            ? "space-y-2 lg:mt-3 lg:shrink-0 lg:border-t lg:pt-3"
            : "space-y-2"
        }
        onKeyDown={handleKeyDown}
      >
        <div className="task-comment-editor border rounded-md p-2">
          <BlockNoteView
            editor={editor}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            sideMenu={false}
            onChange={() => {
              setIsEmpty(isBlocksEmpty(editor.document));
            }}
          >
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={getMemberItems}
            />
          </BlockNoteView>
        </div>
        <Button onClick={handleSubmit} disabled={isEmpty} size="sm">
          Comment
        </Button>
      </div>
      </div>
    </div>
  );
}

// Activity event row — compact, muted styling
function ActivityItem({ item, provider }: { item: TimelineItem; provider: string }) {
  return (
    <div className="relative flex items-center gap-2 py-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background z-10">
        {getActivityIcon(item.type ?? "", provider)}
      </div>
      <div className="flex-1 min-w-0 text-sm text-muted-foreground leading-6">
        {getActivityDescription(item, provider)}
      </div>
      <span
        className="text-xs text-muted-foreground/60 shrink-0 leading-6"
        title={new Date(item._creationTime).toLocaleString()}
      >
        {formatRelativeTimestamp(item._creationTime)}
      </span>
    </div>
  );
}

// Comment item — compact, blends with activity events
function CommentItem({
  item,
  currentUserId,
  editingCommentId,
  workspaceMembers,
  workspaceId,
  uploadFile,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
}: {
  item: TimelineItem;
  currentUserId: Id<"users">;
  editingCommentId: Id<"taskComments"> | null;
  workspaceMembers: WorkspaceMemberSummary[];
  workspaceId: Id<"workspaces">;
  uploadFile?: (file: File) => Promise<string>;
  onEdit: (id: Id<"taskComments"> | null) => void;
  onDelete: (id: Id<"taskComments">) => void;
  onSave: (id: Id<"taskComments">, body: string, bodyMarkdown: string) => void;
  onCancelEdit: () => void;
}) {
  const commentId = item.commentId as Id<"taskComments">;
  const isEditing = editingCommentId === commentId;

  return (
    <div className="group relative flex gap-2 py-1">
      {/* Avatar — same 6x6 size as activity dots. GitHub-synced comments show
          the GitHub logo; Ripple-native comments show the author image/initials. */}
      <Avatar className="h-6 w-6 shrink-0 ring-2 ring-background z-10">
        {item.externalAuthor ? (
          <AvatarFallback className="bg-foreground text-background">
            <GithubMark className="h-3 w-3" />
          </AvatarFallback>
        ) : (
          <>
            {item.userImage && <AvatarImage src={item.userImage} alt={item.userName} />}
            <AvatarFallback className="text-[10px]">
              {item.userName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </>
        )}
      </Avatar>

      <div className="flex-1 min-w-0">
        {/* Name + timestamp — aligned with activity events */}
        <div className="flex items-center gap-2 leading-6">
          <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm flex-1 min-w-0">{item.userName}</span>
          <span
            className="text-xs text-muted-foreground/60 shrink-0"
            title={new Date(item._creationTime).toLocaleString()}
          >
            {formatRelativeTimestamp(item._creationTime)}
          </span>
        </div>

        {/* Body or edit editor */}
        {isEditing ? (
          <EditCommentEditor
            commentId={commentId}
            initialBody={item.body ?? ""}
            workspaceMembers={workspaceMembers}
            workspaceId={workspaceId}
            uploadFile={uploadFile}
            onSave={onSave}
            onCancel={onCancelEdit}
          />
        ) : (
          <div className="relative rounded-md bg-muted/50 px-3 py-1.5 mt-1">
            <CommentBody body={item.body ?? ""} />
            {/* Edit/delete — bottom-right of comment box */}
            {item.userId === currentUserId && (
              <div className="absolute bottom-1 right-1 flex gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onEdit(commentId)}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none"
                  title="Edit comment"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(commentId)}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-destructive outline-none hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:outline-none"
                  title="Delete comment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Lightweight static renderer — avoids a full BlockNote editor per comment
function CommentBody({ body }: { body: string }) {
  return <StaticCommentBody body={body} />;
}

// Edit mode for existing comment
function EditCommentEditor({
  commentId,
  initialBody,
  workspaceMembers,
  uploadFile,
  onSave,
  onCancel,
}: EditCommentEditorProps) {
  const { resolvedTheme } = useTheme();

  const editEditor = useCreateBlockNote({
    schema: taskCommentSchema,
    initialContent: parseCommentBody(initialBody),
    uploadFile,
  });

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor: editEditor,
  });

  const handleSave = () => {
    if (isBlocksEmpty(editEditor.document)) return;
    const body = JSON.stringify(editEditor.document);
    const bodyMarkdown = editEditor.blocksToMarkdownLossy(editEditor.document);
    onSave(commentId, body, bodyMarkdown);
  };

  return (
    <div className="space-y-2">
      <div className="task-comment-editor border rounded-md p-2">
        <BlockNoteView
          editor={editEditor}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={getMemberItems}
          />
        </BlockNoteView>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
