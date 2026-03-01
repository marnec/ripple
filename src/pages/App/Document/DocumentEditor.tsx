import { FavoriteButton } from "@/components/FavoriteButton";
import { SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useEditorTracking, extractCellRefs, extractHardEmbeds } from "../../../hooks/use-editor-tracking";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useSnapshotFallback } from "../../../hooks/use-snapshot-fallback";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { getUserColor } from "../../../lib/user-colors";
import { ActiveUsers } from "./ActiveUsers";
import { CellRefDialog } from "./CellRefDialog";
import { ConnectionStatus } from "./ConnectionStatus";
import { documentSchema as schema } from "./schema";
import { SnapshotFallback } from "./SnapshotFallback";
import { useDocumentSuggestions } from "./useDocumentSuggestions";

export function DocumentEditorContainer() {
  const { documentId } = useParams<QueryParams>();

  if (!documentId) {
    return <p className="p-20">No document selected</p>;
  }

  return <DocumentEditor documentId={documentId} key={documentId} />;
}

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const { resolvedTheme } = useTheme();
  const document = useQuery(api.documents.get, { id: documentId });
  const diagrams = useQuery(
    api.diagrams.list,
    document ? { workspaceId: document.workspaceId } : "skip",
  );
  const spreadsheets = useQuery(
    api.spreadsheets.list,
    document ? { workspaceId: document.workspaceId } : "skip",
  );
  const workspaceMembers = useQuery(
    api.workspaceMembers.membersByWorkspace,
    document ? { workspaceId: document.workspaceId } : "skip",
  );
  const viewer = useQuery(api.users.viewer);
  const ensureCellRef = useMutation(api.spreadsheetCellRefs.ensureCellRef);
  const removeCellRef = useMutation(api.spreadsheetCellRefs.removeCellRef);
  const syncReferences = useMutation(api.contentReferences.syncReferences);

  const [cellRefDialog, setCellRefDialog] = useState<{
    open: boolean;
    spreadsheetId: Id<"spreadsheets">;
    spreadsheetName: string;
  } | null>(null);

  const uploadFile = useUploadFile(document?.workspaceId);

  const { editor, isLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
    uploadFile,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
    mentionType: "mention",
  });

  // Track cell ref removals and clean up orphaned cache entries
  const onCellRefsRemoved = useCallback(
    (removed: Set<string>) => {
      for (const key of removed) {
        const sep = key.indexOf("|");
        const spreadsheetId = key.slice(0, sep) as Id<"spreadsheets">;
        const cellRef = key.slice(sep + 1);
        void removeCellRef({ spreadsheetId, cellRef });
      }
    },
    [removeCellRef],
  );
  useEditorTracking(editor, extractCellRefs, { onRemoved: onCellRefsRemoved });

  // Sync hard-embed references (diagrams, spreadsheets) to contentReferences table
  const onEmbedsChanged = useCallback(
    (current: Set<string>) => {
      if (!document) return;
      const references = [...current].map((key) => {
        const sep = key.indexOf("|");
        return {
          targetType: key.slice(0, sep) as "diagram" | "spreadsheet",
          targetId: key.slice(sep + 1),
        };
      });
      void syncReferences({
        sourceType: "document",
        sourceId: documentId,
        references,
        workspaceId: document.workspaceId,
      });
    },
    [document, documentId, syncReferences],
  );
  useEditorTracking(editor, extractHardEmbeds, {
    onChanged: onEmbedsChanged,
    syncOnMount: true,
  });

  // Cold-start snapshot fallback: offline + no editor from IndexedDB
  const { isColdStart, snapshotDoc } = useSnapshotFallback({
    isOffline,
    hasContent: !!editor,
    resourceType: "doc",
    resourceId: documentId,
  });

  // Suggestion menu items (#-trigger) and cell ref insert handler
  const { getHashItems, handleCellRefInsert } = useDocumentSuggestions({
    diagrams,
    spreadsheets,
    editor,
    ensureCellRef,
    setCellRefDialog,
  });

  if (isColdStart && snapshotDoc) {
    return (
      <SnapshotFallback
        snapshotDoc={snapshotDoc}
        documentName={document?.name}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  if (isLoading || !editor || !document) {
    return <div className="h-full flex-1 min-w-0" />;
  }

  return (
    <div className="h-full flex-1 min-w-0 overflow-y-scroll scrollbar-stable">
      <div className="px-20 max-w-full animate-fade-in">
        <div className="sticky top-0 z-10 flex items-center justify-between pt-5 pb-2 bg-background/80 backdrop-blur-sm">
          <div className="flex h-8 items-center gap-2">
            <FavoriteButton
              resourceType="document"
              resourceId={documentId}
              workspaceId={document.workspaceId}
            />
            <h1 className="text-lg font-semibold truncate">{document.name}</h1>
          </div>
          <div className="flex h-8 items-center gap-3">
            <ConnectionStatus isConnected={isConnected} />
            {isConnected && (
              <ActiveUsers
                remoteUsers={remoteUsers}
                currentUser={
                  viewer
                    ? {
                        name: viewer.name,
                        color: getUserColor(viewer._id),
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
        <BlockNoteView editor={editor} theme={resolvedTheme === "dark" ? "dark" : "light"}>
          <SuggestionMenuController triggerCharacter={"#"} getItems={getHashItems} />
          <SuggestionMenuController triggerCharacter={"@"} getItems={getMemberItems} />
        </BlockNoteView>
        {cellRefDialog && (
          <CellRefDialog
            open={cellRefDialog.open}
            onOpenChange={(open) => {
              if (!open) setCellRefDialog(null);
            }}
            spreadsheetName={cellRefDialog.spreadsheetName}
            onInsert={(cellRef) => {
              if (!cellRefDialog) return;
              handleCellRefInsert(cellRef, cellRefDialog);
            }}
          />
        )}
      </div>
    </div>
  );
}
