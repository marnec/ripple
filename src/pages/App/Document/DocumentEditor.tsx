import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { BacklinksDrawer } from "@/components/BacklinksDrawer";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  TagInlineStrip,
  TagPickerButton,
} from "@/components/TagPickerButton";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { Link2, Link2Off, Settings, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useViewer } from "../UserContext";
import { useLocalRecents } from "@/hooks/use-local-recents";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useEmbedDeleteProtection } from "../../../hooks/use-embed-delete-protection";
import { useEditorTracking, extractCellRefs, extractHardEmbeds, extractDocBlockRefs, extractMentions } from "../../../hooks/use-editor-tracking";
import { useReferencedBlockDeleteProtection } from "../../../hooks/use-referenced-block-delete-protection";
import { useReferencedBlocks } from "../../../hooks/use-referenced-blocks";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useSnapshotFallback } from "../../../hooks/use-snapshot-fallback";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { getUserColor } from "../../../lib/user-colors";
import { ActiveUsers } from "./ActiveUsers";
import { BlockPickerDialog } from "./BlockPickerDialog";
import { CellRefDialog } from "./CellRefDialog";
import { ConnectionStatus } from "./ConnectionStatus";
import { documentSchema as schema } from "./schema";
import { SnapshotFallback } from "./SnapshotFallback";
import { useDocumentSuggestions } from "./useDocumentSuggestions";

export function DocumentEditorContainer() {
  const { documentId } = useParams<QueryParams>();

  if (!documentId) {
    return <SomethingWentWrong />;
  }

  return <DocumentEditor documentId={documentId} key={documentId} />;
}

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const location = useLocation();
  const importedHTML = (location.state as { importedHTML?: string } | null)?.importedHTML;
  const importInjectedRef = useRef(false);
  const document = useQuery(api.documents.get, { id: documentId });
  useRecordVisit(document?.workspaceId, "document", documentId, document?.name);
  const [hashSearch, setHashSearch] = useState("");
  const [debouncedHashSearch, setDebouncedHashSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHashSearch(hashSearch), 200);
    return () => clearTimeout(timer);
  }, [hashSearch]);

  const hasHashSearch = debouncedHashSearch.trim().length > 0;
  const isHashSearchStale = hashSearch !== debouncedHashSearch;

  const recents = useLocalRecents(hasHashSearch ? undefined : document?.workspaceId, 10);
  const searchResults = useQuery(
    api.nodes.search,
    hasHashSearch && document
      ? { workspaceId: document.workspaceId, searchText: debouncedHashSearch }
      : "skip",
  );
  const workspaceMembers = useQuery(
    api.workspaceMembers.membersByWorkspace,
    document ? { workspaceId: document.workspaceId } : "skip",
  );
  const viewer = useViewer();
  const ensureCellRef = useMutation(api.spreadsheetCellRefs.ensureCellRef);
  const removeCellRef = useMutation(api.spreadsheetCellRefs.removeCellRef);
  const ensureBlockRef = useMutation(api.documentBlockRefs.ensureBlockRef);
  const removeBlockRef = useMutation(api.documentBlockRefs.removeBlockRef);
  const syncEdges = useMutation(api.edges.syncEdges);
  const syncMentionEdges = useMutation(api.edges.syncMentionEdges);
  const updateTags = useMutation(api.documents.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.documents.get),
  );

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const myRole = useQuery(
    api.workspaceMembers.myRole,
    document ? { workspaceId: document.workspaceId } : "skip",
  );
  const isAdmin = myRole === "admin";

  const [cellRefDialog, setCellRefDialog] = useState<{
    open: boolean;
    spreadsheetId: Id<"spreadsheets">;
    spreadsheetName: string;
  } | null>(null);

  const [blockPickerDialog, setBlockPickerDialog] = useState<{
    open: boolean;
    documentId: Id<"documents">;
    documentName: string;
  } | null>(null);

  const reportMention = useMutation(api.documents.reportMention);

  const fileUpload = useUploadFile(document?.workspaceId);

  const { editor, isLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
    uploadFile: fileUpload?.uploadFile,
  });

  // Inject imported content (from .docx import) once when the editor is ready
  useEffect(() => {
    if (!editor || !importedHTML || importInjectedRef.current) return;
    importInjectedRef.current = true;
    const blocks = editor.tryParseHTMLToBlocks(importedHTML);
    editor.replaceBlocks(editor.document, blocks);
    window.history.replaceState({}, "");
  }, [editor, importedHTML]);

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
    mentionType: "mention",
  });

  // Track cell ref removals and clean up orphaned cache entries
  const onCellRefsRemoved = (removed: Set<string>) => {
    for (const key of removed) {
      const sep = key.indexOf("|");
      const spreadsheetId = key.slice(0, sep) as Id<"spreadsheets">;
      const cellRef = key.slice(sep + 1);
      void removeCellRef({ spreadsheetId, cellRef });
    }
  };
  useEditorTracking(editor, extractCellRefs, { onRemoved: onCellRefsRemoved });

  // Track document block ref removals
  const onDocBlockRefsRemoved = (removed: Set<string>) => {
    for (const key of removed) {
      const sep = key.indexOf("|");
      const docId = key.slice(0, sep) as Id<"documents">;
      const blockId = key.slice(sep + 1);
      void removeBlockRef({ documentId: docId, blockId });
    }
  };
  useEditorTracking(editor, extractDocBlockRefs, { onRemoved: onDocBlockRefsRemoved });

  // Track @mention additions: sync to edges + notify new mentions
  const onMentionsChanged = (current: Set<string>, previous: Set<string>) => {
    // Sync mention edges (persistent graph)
    if (document) {
      void syncMentionEdges({
        sourceType: "document",
        sourceId: documentId,
        mentionedUserIds: [...current],
        workspaceId: document.workspaceId,
      });
    }
    // Notify newly mentioned users
    const newMentions = [...current].filter((id) => !previous.has(id));
    if (newMentions.length > 0) {
      void reportMention({
        documentId,
        mentionedUserIds: newMentions as Id<"users">[],
      });
    }
  };
  useEditorTracking(editor, extractMentions, { onChanged: onMentionsChanged, syncOnMount: true });

  // Sync hard-embed references (diagrams, spreadsheets, documents) to edges table
  const onEmbedsChanged = (current: Set<string>) => {
    if (!document) return;
    const references = [...current].map((key) => {
      const sep = key.indexOf("|");
      return {
        targetType: key.slice(0, sep) as "diagram" | "spreadsheet" | "document",
        targetId: key.slice(sep + 1),
      };
    });
    void syncEdges({
      sourceType: "document",
      sourceId: documentId,
      references,
      workspaceId: document.workspaceId,
    });
  };
  useEditorTracking(editor, extractHardEmbeds, {
    onChanged: onEmbedsChanged,
    syncOnMount: true,
  });

  // Protect embed blocks from accidental deletion with animation + undo toast
  useEmbedDeleteProtection(editor);

  // Track which blocks in this document are referenced by embeds elsewhere
  const { referencedBlockIds, hasReferencedBlocks } = useReferencedBlocks(documentId);
  const [showReferencedBlocks, setShowReferencedBlocks] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  // stylesActive keeps the <style> tag in the DOM during the exit transition
  const [stylesActive, setStylesActive] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleToggleReferences = () => {
    if (showReferencedBlocks) {
      setShowReferencedBlocks(false);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setStylesActive(false), 220);
    } else {
      clearTimeout(hideTimerRef.current);
      setStylesActive(true);
      setShowReferencedBlocks(true);
      setBacklinksOpen(true);
    }
  };

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  // Protect referenced blocks from accidental deletion
  const onReferencedBlocksDeleted = (blockIds: string[]) => {
    for (const blockId of blockIds) {
      void removeBlockRef({ documentId, blockId });
    }
  };
  useReferencedBlockDeleteProtection(editor, referencedBlockIds, onReferencedBlocksDeleted);

  // Build dynamic CSS rules targeting referenced blocks by their stable data-id
  // (ProseMirror preserves data-id but wipes custom attributes on re-render)
  // stylesActive keeps the <style> in the DOM during exit so the transition can play out.
  const referencedBlockStyles = (() => {
    if (!stylesActive || referencedBlockIds.size === 0) return null;
    const rules = [...referencedBlockIds]
      .map((id) => `.bn-block-outer[data-id="${id}"] > .bn-block`)
      .join(",\n");
    if (showReferencedBlocks) {
      return `${rules} {
  border-left: 2px solid hsl(45 90% 50% / 0.5);
  background-color: hsl(45 90% 50% / 0.06);
  padding-left: 6px;
  border-radius: 0 4px 4px 0;
  transition: border-color 0.2s, background-color 0.2s, padding-left 0.2s;
}`;
    }
    // Exit state: zeroed-out values so the transition animates to nothing
    return `${rules} {
  border-left: 2px solid transparent;
  background-color: transparent;
  padding-left: 0;
  transition: border-color 0.2s, background-color 0.2s, padding-left 0.2s;
}`;
  })();

  // Cold-start snapshot fallback: offline + no editor from IndexedDB
  const { isColdStart, snapshotDoc } = useSnapshotFallback({
    isOffline,
    hasContent: !!editor,
    resourceType: "doc",
    resourceId: documentId,
  });

  // Suggestion menu items (#-trigger) and insert handlers
  const { getHashItems, handleCellRefInsert, handleBlockPickerInsert } = useDocumentSuggestions({
    recents,
    searchResults,
    hasSearch: hasHashSearch,
    isStale: isHashSearchStale,
    editor,
    ensureCellRef,
    ensureBlockRef,
    setCellRefDialog,
    setBlockPickerDialog,
    onSearchChange: setHashSearch,
    currentDocumentId: documentId,
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

  if (document === null) {
    return <ResourceDeleted resourceType="document" />;
  }

  if (isLoading || !editor || !document) {
    return <div className="h-full flex-1 min-w-0" />;
  }

  return (
    <div className="h-full flex-1 min-w-0 flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 min-w-0 items-center gap-4">
          <FavoriteButton
            resourceType="document"
            resourceId={documentId}
            workspaceId={document.workspaceId}
          />
          <TagPickerButton
            workspaceId={document.workspaceId}
            value={document.tags ?? []}
            onChange={(tags) => void updateTags({ id: documentId, tags })}
          />
          <h1 className="hidden sm:block text-lg font-semibold truncate">{document.name}</h1>
          <TagInlineStrip tags={document.tags ?? []} />
          {hasReferencedBlocks && (
            <button
              type="button"
              onClick={handleToggleReferences}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ml-2"
              title={showReferencedBlocks ? "Hide referenced blocks" : "Show referenced blocks"}
            >
              {showReferencedBlocks ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              References
            </button>
          )}
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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShareDialogOpen(true)}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Share"
            >
              <Share2 className="size-4" />
            </button>
          )}
          {!isMobile && (
            <Link
              to="settings"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Document settings"
            >
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {isAdmin && document && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          resourceType="document"
          resourceId={documentId}
          resourceName={document.name}
        />
      )}
      {isMobile && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="settings" />}
            aria-label="Document settings"
          >
            <Settings className="size-4" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={document.name} />
      <div className="flex-1 overflow-y-scroll scrollbar-stable pt-4">
        <div className="px-2 sm:pl-12 sm:pr-20 max-w-full">
          {referencedBlockStyles && <style>{referencedBlockStyles}</style>}
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
          {blockPickerDialog && (
            <BlockPickerDialog
              open={blockPickerDialog.open}
              onOpenChange={(open) => {
                if (!open) setBlockPickerDialog(null);
              }}
              documentId={blockPickerDialog.documentId}
              documentName={blockPickerDialog.documentName}
              onInsert={(blockId) => {
                if (!blockPickerDialog) return;
                handleBlockPickerInsert(blockId, blockPickerDialog);
              }}
            />
          )}
          {document && (
            <BacklinksDrawer
              resourceId={documentId}
              workspaceId={document.workspaceId}
              open={backlinksOpen}
              onOpenChange={setBacklinksOpen}
            />
          )}
        </div>
      </div>
    </div>
  );
}
