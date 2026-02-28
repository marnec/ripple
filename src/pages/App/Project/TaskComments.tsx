import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isBlocksEmpty, parseCommentBody } from "@/lib/editor-utils";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Trash2 } from "lucide-react";
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

type TaskCommentsProps = {
  taskId: Id<"tasks">;
  currentUserId: Id<"users">;
  workspaceId: Id<"workspaces">;
};

export function TaskComments({ taskId, currentUserId, workspaceId }: TaskCommentsProps) {
  const comments = useQuery(api.taskComments.list, { taskId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const createComment = useMutation(api.taskComments.create);
  const updateComment = useMutation(api.taskComments.update);
  const removeComment = useMutation(api.taskComments.remove);

  const uploadFile = useUploadFile(workspaceId);

  const [editingCommentId, setEditingCommentId] = useState<Id<"taskComments"> | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const { resolvedTheme } = useTheme();

  // New comment editor
  const editor = useCreateBlockNote({
    schema: taskCommentSchema,
    uploadFile,
  });

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
  });

  // Handle submitting new comment
  const handleSubmit = () => {
    if (isBlocksEmpty(editor.document)) return;

    const body = JSON.stringify(editor.document);
    void createComment({ taskId, body }).then(() => {
      // Clear the editor
      editor.replaceBlocks(editor.document, [{ id: crypto.randomUUID(), type: "paragraph", content: "" }]);
      setIsEmpty(true);
    });
  };

  // Handle keyboard shortcuts for new comment
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle deleting comment
  const handleDelete = (commentId: Id<"taskComments">) => {
    void removeComment({ id: commentId });
  };

  // Loading state
  if (comments === undefined || workspaceMembers === undefined) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Comments</h3>

      {/* Comment list */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet</p>
        ) : (
          comments.map((comment) => (
            <div key={comment._id} className="flex gap-3">
              {/* Avatar */}
              <Avatar className="h-8 w-8 shrink-0">
                {comment.image && (
                  <AvatarImage src={comment.image} alt={comment.author} />
                )}
                <AvatarFallback className="text-xs">
                  {comment.author.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-medium text-sm">{comment.author}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(comment._creationTime).toLocaleString()}
                  </span>
                </div>

                {/* Comment body or edit mode */}
                {editingCommentId === comment._id ? (
                  <EditCommentEditor
                    commentId={comment._id}
                    initialBody={comment.body}
                    workspaceMembers={workspaceMembers}
                    uploadFile={uploadFile}
                    onSave={(id, body) => {
                      void updateComment({ id, body }).then(() => {
                        setEditingCommentId(null);
                      });
                    }}
                    onCancel={() => setEditingCommentId(null)}
                  />
                ) : (
                  <>
                    <CommentBody body={comment.body} />

                    {/* Author actions */}
                    {comment.userId === currentUserId && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingCommentId(comment._id)}
                          className="h-auto py-1 px-2"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(comment._id)}
                          className="h-auto py-1 px-2 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
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
