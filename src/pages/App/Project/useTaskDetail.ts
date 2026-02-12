import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";

export function useTaskDetail({
  taskId,
  workspaceId,
  projectId,
}: {
  taskId: Id<"tasks"> | null;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const task = useQuery(api.tasks.get, taskId ? { taskId } : "skip");
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useQuery(api.projectMembers.membersByProject, { projectId });
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const documents = useQuery(api.documents.listByUserMembership, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Collaborative editor - Yjs handles sync automatically
  const { editor, isLoading: editorLoading, isConnected, provider } = useDocumentCollaboration({
    documentId: taskId ?? "",
    userName: currentUser?.name ?? "Anonymous",
    userId: currentUser?._id ?? "anonymous",
    schema: taskDescriptionSchema,
    resourceType: "task",
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  const clearDescription = useMutation(api.tasks.clearDescription);

  // One-time migration: Convex description -> Yjs
  const migrationDoneRef = useRef(false);
  useEffect(() => {
    if (!editor || !provider || !task || !taskId || migrationDoneRef.current) return;
    if (!isConnected) return; // Wait for provider to connect

    // Check if Yjs document is empty (no content yet)
    const doc = editor.document;
    const isEmpty = doc.length === 0 ||
      (doc.length === 1 && doc[0].type === "paragraph" &&
       (!doc[0].content || (Array.isArray(doc[0].content) && doc[0].content.length === 0)));

    // If Yjs empty AND Convex has description, migrate
    if (isEmpty && task.description) {
      migrationDoneRef.current = true;
      try {
        const blocks = JSON.parse(task.description);
        editor.replaceBlocks(editor.document, blocks);
        // Clear Convex description to mark as migrated
        void clearDescription({ taskId });
      } catch (err) {
        console.error("Task description migration failed:", err);
      }
    } else {
      // No migration needed (either Yjs has content or no Convex description)
      migrationDoneRef.current = true;
    }
  }, [editor, provider, isConnected, task, taskId, clearDescription]);

  // Sync title when task loads
  useEffect(() => {
    if (task?.title && task.title !== titleValue) {
      setTitleValue(task.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title]);

  const handleTitleBlur = () => {
    if (taskId && titleValue.trim() && titleValue !== task?.title) {
      void updateTask({ taskId, title: titleValue });
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleInputRef.current?.blur();
    }
  };

  const handleStatusChange = (statusId: Id<"taskStatuses">) => {
    if (taskId) void updateTask({ taskId, statusId });
  };

  const handlePriorityChange = (
    priority: "urgent" | "high" | "medium" | "low"
  ) => {
    if (taskId) void updateTask({ taskId, priority });
  };

  const handleAssigneeChange = (value: string) => {
    if (!taskId) return;
    if (value === "unassigned") {
      void updateTask({ taskId, assigneeId: null });
    } else {
      void updateTask({ taskId, assigneeId: value as Id<"users"> });
    }
  };

  const handleAddLabel = (label: string) => {
    if (taskId && task) {
      const updatedLabels = [...(task.labels || []), label];
      void updateTask({ taskId, labels: updatedLabels });
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    if (taskId && task) {
      const updatedLabels = (task.labels || []).filter(
        (l) => l !== labelToRemove
      );
      void updateTask({ taskId, labels: updatedLabels });
    }
  };

  const handleDelete = (onDeleted: () => void) => {
    if (taskId) {
      void removeTask({ taskId }).then(() => {
        setShowDeleteDialog(false);
        onDeleted();
      });
    }
  };

  return {
    task,
    statuses,
    members,
    diagrams,
    documents,
    currentUser,
    editor,
    editorLoading,
    isConnected,
    provider,
    remoteUsers,
    titleValue,
    setTitleValue,
    titleInputRef,
    handleTitleBlur,
    handleTitleKeyDown,
    handleStatusChange,
    handlePriorityChange,
    handleAssigneeChange,
    handleAddLabel,
    handleRemoveLabel,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
  };
}
