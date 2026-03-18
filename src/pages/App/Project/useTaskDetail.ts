import { useMutation, useQuery } from "convex/react";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { useViewer } from "../UserContext";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useUploadFile } from "../../../hooks/use-upload-file";

/** Extract all @mention user IDs from task description blocks. */
function extractMentionUserIds(blocks: any[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "userMention" && ic.props?.userId) {
          ids.add(ic.props.userId);
        }
      }
    }
    if (block.children) {
      for (const id of extractMentionUserIds(block.children)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/** Extract all hard-embed reference keys from task description (diagrams + document block embeds). */
function extractTaskEmbedRefs(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (block.type === "diagram" && block.props?.diagramId) {
      refs.add(`diagram|${block.props.diagramId}`);
    }
    if (block.type === "documentBlockEmbed" && block.props?.documentId) {
      refs.add(`document|${block.props.documentId}`);
    }
    if (block.type === "spreadsheetRange" && block.props?.spreadsheetId) {
      refs.add(`spreadsheet|${block.props.spreadsheetId}`);
    }
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "diagramEmbed" && ic.props?.diagramId) {
          refs.add(`diagram|${ic.props.diagramId}`);
        }
      }
    }
    if (block.children) {
      for (const key of extractTaskEmbedRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Extract documentBlockEmbed keys (documentId|blockId) for block ref cache cleanup. */
function extractTaskDocBlockRefs(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (block.type === "documentBlockEmbed" && block.props?.documentId && block.props?.blockId) {
      refs.add(`${block.props.documentId}|${block.props.blockId}`);
    }
    if (block.children) {
      for (const key of extractTaskDocBlockRefs(block.children)) {
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
  collaborationEnabled = true,
  suggestionDataEnabled = true,
}: {
  taskId: Id<"tasks"> | null;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  /** Defer Yjs/PartyKit connection until true (e.g. when sheet is visible). */
  collaborationEnabled?: boolean;
  /** Defer diagrams/documents list queries until true (only needed for # suggestion menu). */
  suggestionDataEnabled?: boolean;
}) {
  const task = useQuery(api.tasks.get, taskId ? { taskId } : "skip");
  const statuses = useQuery(api.taskStatuses.listByProject, projectId ? { projectId } : "skip");
  const rawMembers = useWorkspaceMembers();
  const members = rawMembers?.map((m) => ({ ...m, userId: m._id }));
  const diagrams = useQuery(api.diagrams.list, suggestionDataEnabled ? { workspaceId } : "skip");
  const documents = useQuery(api.documents.list, suggestionDataEnabled ? { workspaceId } : "skip");
  const spreadsheets = useQuery(api.spreadsheets.list, suggestionDataEnabled ? { workspaceId } : "skip");
  const currentUser = useViewer();

  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const syncEdges = useMutation(api.edges.syncEdges);
  const syncMentionEdges = useMutation(api.edges.syncMentionEdges);
  const removeBlockRef = useMutation(api.documentBlockRefs.removeBlockRef);
  const notifyMentions = useMutation(api.tasks.notifyDescriptionMentions);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const fileUpload = useUploadFile(workspaceId);

  // Collaborative editor - Yjs handles sync automatically
  const { editor, isLoading: editorLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId: taskId ?? "",
    userName: currentUser?.name ?? "Anonymous",
    userId: currentUser?._id ?? "anonymous",
    schema: taskDescriptionSchema,
    resourceType: "task",
    enabled: !!taskId && collaborationEnabled,
    uploadFile: fileUpload?.uploadFile,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  // Parse "type|id" keys into edges format
  const parseEmbedRefs = useCallback((keys: Set<string>) => {
    return [...keys].map((key) => {
      const [targetType, targetId] = key.split("|");
      return { targetType: targetType as "diagram" | "document" | "spreadsheet", targetId };
    });
  }, []);

  // Sync embed references (diagrams + document block embeds) to edges table
  const prevEmbedsRef = useRef<Set<string>>(new Set());
  const embedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractTaskEmbedRefs(editor.document);
    prevEmbedsRef.current = initial;

    // Sync on mount so pre-existing embeds get tracked
    if (initial.size > 0) {
      void syncEdges({
        sourceType: "task",
        sourceId: taskId,
        references: parseEmbedRefs(initial),
        workspaceId,
      });
    }

    const unsubscribe = editor.onChange(() => {
      if (embedDebounceRef.current) clearTimeout(embedDebounceRef.current);
      embedDebounceRef.current = setTimeout(() => {
        const current = extractTaskEmbedRefs(editor.document);
        if (current.size !== prevEmbedsRef.current.size ||
            [...current].some((k) => !prevEmbedsRef.current.has(k))) {
          void syncEdges({
            sourceType: "task",
            sourceId: taskId,
            references: parseEmbedRefs(current),
            workspaceId,
          });
        }
        prevEmbedsRef.current = current;
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (embedDebounceRef.current) clearTimeout(embedDebounceRef.current);
    };
  }, [editor, taskId, workspaceId, syncEdges, parseEmbedRefs]);

  // Track document block ref removals for cache cleanup
  const prevDocBlockRefsRef = useRef<Set<string>>(new Set());
  const docBlockRefDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor || !taskId) return;
    prevDocBlockRefsRef.current = extractTaskDocBlockRefs(editor.document);

    const unsubscribe = editor.onChange(() => {
      if (docBlockRefDebounceRef.current) clearTimeout(docBlockRefDebounceRef.current);
      docBlockRefDebounceRef.current = setTimeout(() => {
        const current = extractTaskDocBlockRefs(editor.document);
        // Clean up removed block refs
        for (const key of prevDocBlockRefsRef.current) {
          if (!current.has(key)) {
            const [documentId, blockId] = key.split("|");
            void removeBlockRef({
              documentId: documentId as Id<"documents">,
              blockId,
            });
          }
        }
        prevDocBlockRefsRef.current = current;
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (docBlockRefDebounceRef.current) clearTimeout(docBlockRefDebounceRef.current);
    };
  }, [editor, taskId, removeBlockRef]);

  // Track @mentions in task description: sync to edges + notify new mentions
  const prevMentionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractMentionUserIds(editor.document);
    prevMentionsRef.current = initial;

    // Sync on mount so pre-existing mentions get tracked
    if (initial.size > 0) {
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedUserIds: [...initial],
        workspaceId,
      });
    }

    const unsubscribe = editor.onChange(() => {
      const current = extractMentionUserIds(editor.document);
      // Sync mention edges (persistent graph)
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedUserIds: [...current],
        workspaceId,
      });
      // Notify newly mentioned users
      const added = [...current].filter((id) => !prevMentionsRef.current.has(id));
      if (added.length > 0) {
        void notifyMentions({
          taskId,
          mentionedUserIds: added as Id<"users">[],
        });
      }
      prevMentionsRef.current = current;
    });

    return () => { unsubscribe(); };
  }, [editor, taskId, workspaceId, notifyMentions, syncMentionEdges]);

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

  const handleDueDateChange = (date: string | null) => {
    if (taskId) void updateTask({ taskId, dueDate: date });
  };

  const handleStartDateChange = (date: string | null) => {
    if (taskId) void updateTask({ taskId, startDate: date });
  };

  const handleEstimateChange = (value: number | null) => {
    if (taskId) void updateTask({ taskId, estimate: value });
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
    spreadsheets,
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
    handleDueDateChange,
    handleStartDateChange,
    handleEstimateChange,
  };
}
