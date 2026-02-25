import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useUploadFile } from "../../../hooks/use-upload-file";

/** Extract diagram references (diagram blocks + diagramEmbed inline) from task description. */
function extractTaskDiagramEmbeds(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (block.type === "diagram" && block.props?.diagramId) {
      refs.add(block.props.diagramId);
    }
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "diagramEmbed" && ic.props?.diagramId) {
          refs.add(ic.props.diagramId);
        }
      }
    }
    if (block.children) {
      for (const key of extractTaskDiagramEmbeds(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

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
  const rawMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const members = rawMembers?.map((m) => ({ ...m, userId: m._id }));
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const documents = useQuery(api.documents.list, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const syncReferences = useMutation(api.contentReferences.syncReferences);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useUploadFile(workspaceId);

  // Collaborative editor - Yjs handles sync automatically
  const { editor, isLoading: editorLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId: taskId ?? "",
    userName: currentUser?.name ?? "Anonymous",
    userId: currentUser?._id ?? "anonymous",
    schema: taskDescriptionSchema,
    resourceType: "task",
    enabled: !!taskId,
    uploadFile,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  // Sync diagram embed references to contentReferences table
  const prevDiagramEmbedsRef = useRef<Set<string>>(new Set());
  const diagramEmbedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractTaskDiagramEmbeds(editor.document);
    prevDiagramEmbedsRef.current = initial;

    // Sync on mount so pre-existing embeds get tracked
    if (initial.size > 0) {
      const references = [...initial].map((diagramId) => ({
        targetType: "diagram" as const,
        targetId: diagramId,
      }));
      void syncReferences({
        sourceType: "task",
        sourceId: taskId,
        references,
        workspaceId,
      });
    }

    const unsubscribe = editor.onChange(() => {
      if (diagramEmbedDebounceRef.current) clearTimeout(diagramEmbedDebounceRef.current);
      diagramEmbedDebounceRef.current = setTimeout(() => {
        const current = extractTaskDiagramEmbeds(editor.document);
        if (current.size !== prevDiagramEmbedsRef.current.size ||
            [...current].some((k) => !prevDiagramEmbedsRef.current.has(k))) {
          const references = [...current].map((diagramId) => ({
            targetType: "diagram" as const,
            targetId: diagramId,
          }));
          void syncReferences({
            sourceType: "task",
            sourceId: taskId,
            references,
            workspaceId,
          });
        }
        prevDiagramEmbedsRef.current = current;
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (diagramEmbedDebounceRef.current) clearTimeout(diagramEmbedDebounceRef.current);
    };
  }, [editor, taskId, workspaceId, syncReferences]);

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
    isOffline,
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
