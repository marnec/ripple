import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { taskLabelsOptimisticUpdate } from "@/lib/tag-optimistic";
import { useViewer } from "../UserContext";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { en as bnEn } from "@blocknote/core/locales";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { SEED_ORIGIN } from "@/lib/yjs-origins";

// Delay before edit-detection arms, so BlockNote's mount-time default-paragraph
// insert and any post-seed normalization (both local Yjs transactions) don't
// get mistaken for a user edit.
const DESCRIPTION_EDIT_SETTLE_MS = 400;

const taskDescriptionDictionary = {
  ...bnEn,
  placeholders: {
    ...bnEn.placeholders,
    default: "Write a description… # refs, @ mentions, / commands",
    emptyDocument: "Write a description… # refs, @ mentions, / commands",
  },
};
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { extractEventMentions } from "../../../hooks/use-editor-tracking";

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

  const updateTask = useMutation(api.tasks.update).withOptimisticUpdate(
    taskLabelsOptimisticUpdate(),
  );
  const removeTask = useMutation(api.tasks.remove);
  const syncEdges = useMutation(api.edges.syncEdges);
  const syncMentionEdges = useMutation(api.edges.syncMentionEdges);
  const removeBlockRef = useMutation(api.documentBlockRefs.removeBlockRef);
  const notifyMentions = useMutation(api.tasks.notifyDescriptionMentions);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const fileUpload = useUploadFile(workspaceId);

  // GitHub link state — drives the description-seed gate and edit tracking.
  // Same subscription the sync button uses (Convex collapses it at the cache).
  const githubLink = useQuery(
    api.integrations.core.taskLinks.getByTask,
    taskId ? { taskId } : "skip",
  );
  const seedExpected = githubLink?.seedExpected ?? false;
  const snapshotId = githubLink?.descriptionSnapshotId ?? null;
  const descriptionEdited = githubLink?.descriptionEdited ?? false;
  const isGithubLinked = !!githubLink;
  // `undefined` while the link query is in flight — gate the editor until we
  // know whether a seed is coming (only matters for taskId present).
  const seedStatusLoading = !!taskId && githubLink === undefined;
  const markDescriptionEdited = useMutation(api.tasks.markDescriptionEdited);

  // Collaborative editor - Yjs handles sync automatically
  const { editor, isLoading: editorLoading, isConnected, isOffline, provider, yDoc, descriptionReady, awaitingSeed } = useDocumentCollaboration({
    documentId: taskId ?? "",
    userName: currentUser?.name ?? "Anonymous",
    userId: currentUser?._id ?? "anonymous",
    schema: taskDescriptionSchema,
    resourceType: "task",
    enabled: !!taskId && collaborationEnabled,
    uploadFile: fileUpload?.uploadFile,
    dictionary: taskDescriptionDictionary,
    seed: {
      expected: seedExpected,
      snapshotId,
      edited: descriptionEdited,
      statusLoading: seedStatusLoading,
      seedStatus: githubLink?.seedStatus,
    },
  });

  // Mark the description as user-edited (persisted on the link) the first time
  // a GENUINE local edit lands, so the "Sync to GitHub" button appears only
  // after a real edit — never for the seed itself. Guards:
  //  - only for linked, not-yet-edited tasks once the editor is ready,
  //  - a settle window so mount/normalization transactions don't count,
  //  - tr.local excludes the seed (applyUpdate) and remote collaborators,
  //  - SEED_ORIGIN is belt-and-suspenders for our own snapshot apply,
  //  - tr.changed.size>0 skips selection-only transactions.
  useEffect(() => {
    if (!yDoc || !taskId) return;
    if (!isGithubLinked || descriptionEdited || !descriptionReady) return;

    let armed = false;
    const armTimer = setTimeout(() => {
      armed = true;
    }, DESCRIPTION_EDIT_SETTLE_MS);

    const onAfterTransaction = (tr: {
      local: boolean;
      origin: unknown;
      changed: { size: number };
    }) => {
      if (!armed) return;
      if (!tr.local || tr.origin === SEED_ORIGIN || tr.changed.size === 0) return;
      yDoc.off("afterTransaction", onAfterTransaction);
      void markDescriptionEdited({ taskId });
    };

    yDoc.on("afterTransaction", onAfterTransaction);
    return () => {
      clearTimeout(armTimer);
      yDoc.off("afterTransaction", onAfterTransaction);
    };
  }, [yDoc, taskId, isGithubLinked, descriptionEdited, descriptionReady, markDescriptionEdited]);

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  // Parse "type|id" keys into edges format
  // eslint-disable-next-line react-hooks/exhaustive-deps -- React Compiler memoizes
  const parseEmbedRefs = (keys: Set<string>) => {
    return [...keys].map((key) => {
      const [targetType, targetId] = key.split("|");
      return { targetType: targetType as "diagram" | "document" | "spreadsheet", targetId };
    });
  };

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

  // Track @event mentions in task description: sync to mention edges. The
  // mutation diffs user / event edges independently, so this runs alongside
  // the user-mention effect without interference.
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractEventMentions(editor.document);
    if (initial.size > 0) {
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedEventIds: [...initial],
        workspaceId,
      });
    }
    const unsubscribe = editor.onChange(() => {
      const current = extractEventMentions(editor.document);
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedEventIds: [...current],
        workspaceId,
      });
    });
    return () => { unsubscribe(); };
  }, [editor, taskId, workspaceId, syncMentionEdges]);

  // Sync title when task loads — render-time derived state from server.
  const [prevServerTitle, setPrevServerTitle] = useState<string | undefined>(
    task?.title,
  );
  if (task?.title !== prevServerTitle) {
    setPrevServerTitle(task?.title);
    if (task?.title && task.title !== titleValue) {
      setTitleValue(task.title);
    }
  }

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

  const handleSetTags = (tags: string[]) => {
    if (taskId) {
      void updateTask({ taskId, labels: tags });
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (taskId && task) {
      const next = (task.labels || []).filter((t) => t !== tagToRemove);
      void updateTask({ taskId, labels: next });
    }
  };

  const handleDueDateChange = (date: string | null) => {
    if (taskId) void updateTask({ taskId, dueDate: date });
  };

  const handlePlannedStartDateChange = (date: string | null) => {
    if (taskId) void updateTask({ taskId, plannedStartDate: date });
  };

  const handleEstimateChange = (value: number | null) => {
    if (taskId) void updateTask({ taskId, estimate: value });
  };

  const handleDelete = (onDeleted: () => void, closeGithubIssue = false) => {
    if (taskId) {
      void removeTask({ taskId, closeGithubIssue }).then(() => {
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
    descriptionReady,
    awaitingSeed,
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
    handleSetTags,
    handleRemoveTag,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
    isGithubLinked,
    handleDueDateChange,
    handlePlannedStartDateChange,
    handleEstimateChange,
  };
}
