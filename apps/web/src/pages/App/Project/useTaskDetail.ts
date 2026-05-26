import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { taskLabelsOptimisticUpdate } from "@/lib/tag-optimistic";
import { useViewer } from "../UserContext";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { en as bnEn } from "@blocknote/core/locales";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useTaskGithubLink } from "./useTaskGithubLink";
import { useTaskEditTracking } from "./useTaskEditTracking";

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

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const fileUpload = useUploadFile(workspaceId);

  // GitHub link state — drives the description-seed gate and edit tracking.
  // Consumes the single `useTaskGithubLink` boundary (one shaping site, shared
  // with the sync button / indicators) rather than re-querying `getByTask`.
  const github = useTaskGithubLink(taskId);
  const isGithubLinked = github.isLinked;
  const descriptionEdited = github.descriptionEdited;

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
      expected: github.seed.expected,
      snapshotId: github.seed.snapshotId,
      edited: github.descriptionEdited,
      statusLoading: github.seed.statusLoading,
      seedStatus: github.seed.seedStatus,
    },
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  // All description-editor tracking (embed/doc-block/mention edges + the
  // first-edit "mark description edited" signal) lives behind one hook.
  useTaskEditTracking({
    editor,
    yDoc,
    taskId,
    workspaceId,
    descriptionReady,
    isGithubLinked,
    descriptionEdited,
  });

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
