import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type TaskCommentsProps = {
  taskId: Id<"tasks">;
  currentUserId: Id<"users">;
};

export function TaskComments({ taskId, currentUserId }: TaskCommentsProps) {
  const comments = useQuery(api.taskComments.list, { taskId });
  const createComment = useMutation(api.taskComments.create);
  const updateComment = useMutation(api.taskComments.update);
  const removeComment = useMutation(api.taskComments.remove);

  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<Id<"taskComments"> | null>(null);
  const [editingBody, setEditingBody] = useState("");

  // Handle submitting new comment
  const handleSubmit = () => {
    if (!commentBody.trim()) return;

    void createComment({ taskId, body: commentBody.trim() }).then(() => {
      setCommentBody("");
    });
  };

  // Handle keyboard shortcuts for new comment
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle starting edit mode
  const handleEdit = (commentId: Id<"taskComments">, currentBody: string) => {
    setEditingCommentId(commentId);
    setEditingBody(currentBody);
  };

  // Handle saving edited comment
  const handleSave = (commentId: Id<"taskComments">) => {
    if (!editingBody.trim()) return;

    void updateComment({ id: commentId, body: editingBody.trim() }).then(() => {
      setEditingCommentId(null);
      setEditingBody("");
    });
  };

  // Handle canceling edit
  const handleCancel = () => {
    setEditingCommentId(null);
    setEditingBody("");
  };

  // Handle deleting comment
  const handleDelete = (commentId: Id<"taskComments">) => {
    void removeComment({ id: commentId });
  };

  // Loading state
  if (comments === undefined) {
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
                  <div className="space-y-2">
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      className="text-sm resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSave(comment._id)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancel}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{comment.body}</p>

                    {/* Author actions */}
                    {comment.userId === currentUserId && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(comment._id, comment.body)}
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
      <div className="space-y-2">
        <Textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment... (Ctrl+Enter to submit)"
          className="text-sm resize-none"
          rows={3}
        />
        <Button
          onClick={handleSubmit}
          disabled={!commentBody.trim()}
          size="sm"
        >
          Comment
        </Button>
      </div>
    </div>
  );
}
