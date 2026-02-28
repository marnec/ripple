import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isBlocksEmpty, parseCommentBody } from "@/lib/editor-utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CircleDot,
  Link2,
  MessageSquare,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Type,
  UserRound,
  Calendar,
  Clock,
  Gauge,
  Minus,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { SuggestionMenuController } from "@blocknote/react";
import { taskCommentSchema } from "./taskCommentSchema";
import { useTheme } from "next-themes";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";

type TaskActivityTimelineProps = {
  taskId: Id<"tasks">;
  currentUserId: Id<"users">;
  workspaceId: Id<"workspaces">;
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
  // comment fields
  commentId?: string;
  body?: string;
};


function getActivityIcon(type: string) {
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
    default: return <Minus className="h-3 w-3" />;
  }
}

function getActivityDescription(item: TimelineItem): React.ReactNode {
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
      return <><span className="font-medium">{userName}</span> added label <span className="font-medium">{newValue}</span></>;
    case "label_remove":
      return <><span className="font-medium">{userName}</span> removed label <span className="font-medium">{oldValue}</span></>;
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
    default:
      return <><span className="font-medium">{userName}</span> made a change</>;
  }
}

export function TaskActivityTimeline({ taskId, currentUserId, workspaceId }: TaskActivityTimelineProps) {
  const timeline = useQuery(api.taskActivity.timeline, { taskId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const createComment = useMutation(api.taskComments.create);
  const updateComment = useMutation(api.taskComments.update);
  const removeComment = useMutation(api.taskComments.remove);

  const uploadFile = useUploadFile(workspaceId);

  const [filter, setFilter] = useState<"all" | "comments">("comments");
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
    void createComment({ taskId, body }).then(() => {
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

  if (timeline === undefined || workspaceMembers === undefined) {
    return <LoadingSpinner />;
  }

  const filteredItems = filter === "comments"
    ? timeline.filter((item: TimelineItem) => item.kind === "comment")
    : timeline;

  return (
    <div className="space-y-4">
      {/* Header with filter */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Activity</h3>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "comments")}>
          <TabsList className="h-7">
            <TabsTrigger value="all" className="text-xs px-2 py-0.5">All</TabsTrigger>
            <TabsTrigger value="comments" className="text-xs px-2 py-0.5">Comments</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Timeline items with connector line */}
      <div className="relative">
        {/* Vertical connector line */}
        {filteredItems.length > 1 && (
          <div className="absolute left-2.75 top-3 bottom-3 w-px bg-border" />
        )}
        <div className="space-y-1">
          {filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet</p>
          ) : (
            filteredItems.map((item: TimelineItem) =>
              item.kind === "comment" ? (
                <CommentItem
                  key={item._id}
                  item={item}
                  currentUserId={currentUserId}
                  editingCommentId={editingCommentId}
                  workspaceMembers={workspaceMembers}
                  uploadFile={uploadFile}
                  onEdit={setEditingCommentId}
                  onDelete={handleDelete}
                  onSave={(id, body) => {
                    void updateComment({ id, body }).then(() => {
                      setEditingCommentId(null);
                    });
                  }}
                  onCancelEdit={() => setEditingCommentId(null)}
                />
              ) : (
                <ActivityItem key={item._id} item={item} />
              )
            )
          )}
        </div>
      </div>

      {/* Comment input */}
      <div className="space-y-2" onKeyDown={handleKeyDown}>
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
  );
}

// Activity event row — compact, muted styling
function ActivityItem({ item }: { item: TimelineItem }) {
  return (
    <div className="relative flex items-center gap-2 py-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground z-10">
        {getActivityIcon(item.type ?? "")}
      </div>
      <div className="flex-1 min-w-0 text-sm text-muted-foreground leading-6">
        {getActivityDescription(item)}
      </div>
      <span className="text-xs text-muted-foreground/60 shrink-0 leading-6">
        {new Date(item._creationTime).toLocaleString()}
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
  uploadFile,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
}: {
  item: TimelineItem;
  currentUserId: Id<"users">;
  editingCommentId: Id<"taskComments"> | null;
  workspaceMembers: Array<{ _id: Id<"users">; name?: string; image?: string }>;
  uploadFile?: (file: File) => Promise<string>;
  onEdit: (id: Id<"taskComments"> | null) => void;
  onDelete: (id: Id<"taskComments">) => void;
  onSave: (id: Id<"taskComments">, body: string) => void;
  onCancelEdit: () => void;
}) {
  const commentId = item.commentId as Id<"taskComments">;
  const isEditing = editingCommentId === commentId;

  return (
    <div className="group relative flex gap-2 py-1">
      {/* Avatar — same 6x6 size as activity dots */}
      <Avatar className="h-6 w-6 shrink-0 z-10">
        {item.userImage && <AvatarImage src={item.userImage} alt={item.userName} />}
        <AvatarFallback className="text-[10px]">
          {item.userName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        {/* Name + timestamp — aligned with activity events */}
        <div className="flex items-center gap-2 leading-6">
          <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm flex-1 min-w-0">{item.userName}</span>
          <span className="text-xs text-muted-foreground/60 shrink-0">
            {new Date(item._creationTime).toLocaleString()}
          </span>
        </div>

        {/* Body or edit editor */}
        {isEditing ? (
          <EditCommentEditor
            commentId={commentId}
            initialBody={item.body ?? ""}
            workspaceMembers={workspaceMembers}
            uploadFile={uploadFile}
            onSave={onSave}
            onCancel={onCancelEdit}
          />
        ) : (
          <div className="relative rounded-md bg-muted/50 px-3 py-1.5 mt-1">
            <CommentBody body={item.body ?? ""} />
            {/* Edit/delete — bottom-right of comment box */}
            {item.userId === currentUserId && (
              <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(commentId)}
                  className="h-5 w-5"
                  title="Edit comment"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(commentId)}
                  className="h-5 w-5 text-destructive hover:text-destructive"
                  title="Delete comment"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Read-only comment body display
function CommentBody({ body }: { body: string }) {
  const { resolvedTheme } = useTheme();

  const displayEditor = useCreateBlockNote({
    schema: taskCommentSchema,
    initialContent: parseCommentBody(body),
  });

  return (
    <div className="task-comment-editor">
      <BlockNoteView
        editor={displayEditor}
        editable={false}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
      />
    </div>
  );
}

// Edit mode for existing comment
type EditCommentEditorProps = {
  commentId: Id<"taskComments">;
  initialBody: string;
  workspaceMembers: Array<{ _id: Id<"users">; name?: string; image?: string }>;
  uploadFile?: (file: File) => Promise<string>;
  onSave: (id: Id<"taskComments">, body: string) => void;
  onCancel: () => void;
};

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
    onSave(commentId, body);
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
