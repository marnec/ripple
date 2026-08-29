import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { taskLabelsOptimisticUpdate } from "@/lib/tag-optimistic";
import { useViewer } from "../UserContext";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";
import { createTaskPatch, taskDetailLoadState } from "./taskDetailModel";
import { richTextDictionary } from "@/lib/blocknote/rich-text-schema";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useResourceDoc } from "../../../hooks/use-collab-session";
import { syncState } from "@/lib/collab/connection-policy";
import { useTaskGithubLink } from "./useTaskGithubLink";
import { useTaskEditTracking } from "./useTaskEditTracking";

const taskDescriptionDictionary = {
  ...richTextDictionary,
  placeholders: {
    ...richTextDictionary.placeholders,
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
}: {
  taskId: Id<"tasks"> | null;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  /** Defer Yjs/PartyKit connection until true (e.g. when sheet is visible). */
  collaborationEnabled?: boolean;
}) {
  const task = useQuery(api.tasks.get, taskId ? { taskId } : "skip");
  const statuses = useQuery(api.taskStatuses.listByProject, projectId ? { projectId } : "skip");
  const rawMembers = useWorkspaceMembers();
  const members = rawMembers?.map((m) => ({ ...m, userId: m._id }));
  // No diagrams/documents/spreadsheets lists here. They existed only to feed
  // the description editor's `#` picker, which now asks `nodes.suggest` per
  // keystroke; a `suggestionDataEnabled` flag had to gate them because three
  // whole-workspace subscriptions were too expensive to mount eagerly. Nothing
  // to gate any more — see TaskDescriptionEditor.
  const currentUser = useViewer();

  const updateTask = useMutation(api.tasks.update).withOptimisticUpdate(
    taskLabelsOptimisticUpdate(),
  );
  const removeTask = useMutation(api.tasks.remove);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const fileUpload = useUploadFile(workspaceId);

  // Integration link state — drives the description-seed gate, edit tracking,
  // and provider-aware copy (timeline labels, seed notice). Consumes the
  // single `useTaskGithubLink` boundary (one shaping site, shared with the
  // sync button / indicators) rather than re-querying `getByTask`.
  const github = useTaskGithubLink(taskId);
  const isGithubLinked = github.isLinked;
  const descriptionEdited = github.descriptionEdited;
  // Aliased separately from the Yjs `provider` (collaboration transport)
  // exported below — same name, very different things.
  const linkedProvider = github.provider;

  // The description's room. Opened here rather than by `CollaborativeSurface`:
  // a description is a panel inside a task, not a surface of its own — no
  // header, no settings route, and its gate is inline and compact.
  const doc = useResourceDoc({
    resourceType: "task",
    resourceId: taskId ?? "",
    enabled: !!taskId && collaborationEnabled,
  });
  const { isOffline, isHydrated, provider, yDoc } = doc;

  // Collaborative editor - Yjs handles sync automatically
  const { editor, descriptionReady, awaitingSeed } = useDocumentCollaboration({
    doc,
    documentId: taskId ?? "",
    userName: currentUser?.name ?? "Anonymous",
    userId: currentUser?._id ?? "anonymous",
    schema: taskDescriptionSchema,
    resourceType: "task",
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

  // The one write path. Every property edit goes through it, so the error
  // path (and the "no task selected" guard) is written once instead of nine
  // times — eight of which used to swallow rejections silently.
  const patch = createTaskPatch({ taskId, updateTask });

  const handleTitleBlur = () => {
    if (titleValue.trim() && titleValue !== task?.title) {
      void patch({ title: titleValue });
    }
  };

  // Blur the input the event came from rather than holding a ref to it. The
  // ref used to be threaded out of this hook and every consumer had to
  // destructure it away, because reading any member off a ref-carrying object
  // trips the React Compiler's "no refs during render" rule.
  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
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
    currentUser,
    editor,
    descriptionReady,
    awaitingSeed,
    // The whole sync state, not just `isConnected`: the toolbar used to be
    // handed one boolean and so showed a hard offline verdict while a
    // connection attempt was still in flight.
    sync: syncState(doc),
    // The description has never been on this device and nothing can reach it.
    unavailableOffline: isOffline && !isHydrated,
    linkedProvider,
    remoteUsers,
    titleValue,
    setTitleValue,
    handleTitleBlur,
    handleTitleKeyDown,
    patch,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
    isGithubLinked,
    loadState: taskDetailLoadState({ task, statuses, members }),
  };
}
