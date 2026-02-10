import { useCreateBlockNote } from "@blocknote/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";

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

  const descriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadedTaskIdRef = useRef<Id<"tasks"> | null>(null);
  const suppressOnChangeRef = useRef(false);

  const editor = useCreateBlockNote({ schema: taskDescriptionSchema });

  // Sync title when task loads
  useEffect(() => {
    if (task?.title && task.title !== titleValue) {
      setTitleValue(task.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title]);

  // Load description into editor when task changes
  useEffect(() => {
    if (!task || !taskId) return;
    if (loadedTaskIdRef.current === taskId) return;
    loadedTaskIdRef.current = taskId;

    suppressOnChangeRef.current = true;
    if (task.description) {
      const blocks = JSON.parse(task.description);
      editor.replaceBlocks(editor.document, blocks);
    } else {
      editor.replaceBlocks(editor.document, []);
    }
  }, [task, taskId, editor]);

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

  const handleDescriptionChange = () => {
    if (suppressOnChangeRef.current) {
      suppressOnChangeRef.current = false;
      return;
    }

    if (descriptionTimeoutRef.current) {
      clearTimeout(descriptionTimeoutRef.current);
    }

    descriptionTimeoutRef.current = setTimeout(() => {
      if (taskId) {
        void updateTask({
          taskId,
          description: JSON.stringify(editor.document),
        });
      }
    }, 500);
  };

  const handleDelete = (onDeleted: () => void) => {
    if (taskId) {
      void removeTask({ taskId }).then(() => {
        setShowDeleteDialog(false);
        onDeleted();
      });
    }
  };

  const resetEditor = () => {
    loadedTaskIdRef.current = null;
    if (descriptionTimeoutRef.current) {
      clearTimeout(descriptionTimeoutRef.current);
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
    handleDescriptionChange,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
    resetEditor,
  };
}
