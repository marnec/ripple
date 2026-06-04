import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { BacklinksDrawer } from "@/components/BacklinksDrawer";
import { FavoriteButton } from "@/components/FavoriteButton";
import { DocumentActionsMenu } from "./DocumentActionsMenu";
import { Button } from "@/components/ui/button";
import {
  TagInlineStrip,
  TagPickerButton,
} from "@/components/TagPickerButton";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { cn } from "@/lib/utils";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAutoHideScrollbar } from "@/hooks/use-autohide-scrollbar";
import {
  BlockNoteViewEditor,
  SuggestionMenuController,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { Link2, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useViewer } from "../UserContext";
import { useLocalRecents } from "@/hooks/use-local-recents";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { en as bnEn } from "@blocknote/core/locales";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";

// The WebGL "reveal ripple" that fired on clicks outside the editor is disabled
// — editor-boundary detection is now handled by the caret-guard whitelist + the
// spotlight frame, so the ripple is purely decorative and was distracting. Kept
// behind a flag (not deleted) because the effect is complex and may be reused
// elsewhere; flip to `true` to bring it back.
const SHOW_EDITOR_REVEAL_RIPPLE = false;

const documentDictionary = {
  ...bnEn,
  placeholders: {
    ...bnEn.placeholders,
    default: "Start writing… # refs, @ mentions, / commands",
    emptyDocument: "Start writing… # refs, @ mentions, / commands",
  },
};
import { useEmbedDeleteProtection } from "../../../hooks/use-embed-delete-protection";
import { useEditorTracking, extractCellRefs, extractHardEmbeds, extractDocBlockRefs, extractMentions, extractEventMentions } from "../../../hooks/use-editor-tracking";
import { useReferencedBlockDeleteProtection } from "../../../hooks/use-referenced-block-delete-protection";
import { useReferencedBlocks } from "../../../hooks/use-referenced-blocks";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { useEventSuggestions } from "../../../hooks/use-event-suggestions";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { useSnapshotFallback } from "../../../hooks/use-snapshot-fallback";
import { useUploadFile } from "../../../hooks/use-upload-file";
import { getUserColor } from "../../../lib/user-colors";
import { ActiveUsers } from "./ActiveUsers";
import { BlockPickerDialog } from "./BlockPickerDialog";
import { CellRefDialog } from "./CellRefDialog";
import { FramePickerDialog } from "./FramePickerDialog";
import { ConnectionStatus } from "./ConnectionStatus";
import { DocumentSpotlightFrame } from "./DocumentSpotlightFrame";
import { EditorRevealRipple } from "./EditorRevealRipple";
import { ReferencedBlocksHighlight } from "./ReferencedBlocksHighlight";
import {
  CommentsUIProvider,
  CommentsToggleButton,
  CommentCountReporter,
  CommentPendingWatcher,
  CommentsDockedRail,
  CommentsDrawer,
} from "./CommentsRail";
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
      ? {
          workspaceId: document.workspaceId,
          searchText: debouncedHashSearch,
        }
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

  const [framePickerDialog, setFramePickerDialog] = useState<{
    open: boolean;
    diagramId: Id<"diagrams">;
    diagramName: string;
  } | null>(null);

  const reportMention = useMutation(api.documents.reportMention);

  const fileUpload = useUploadFile(document?.workspaceId);

  const { editor, isLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
    uploadFile: fileUpload?.uploadFile,
    dictionary: documentDictionary,
    // Collaborative comments — gated on a real viewer so threads are never
    // attributed to the "anonymous" fallback id.
    enableComments: !!viewer?._id,
  });

  // Mirrors `enableComments` above: the comments extension only exists for a
  // real viewer, so all comment UI (toggle, rail, reporter) is gated on this.
  const commentsEnabled = !!viewer?._id;

  // Editor scroll container: scrollbar appears only while scrolling, then fades.
  const editorScrollRef = useAutoHideScrollbar<HTMLDivElement>();

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

  const getEventItems = useEventSuggestions({
    workspaceId: document?.workspaceId,
    editor,
  });

  // Combined `@` suggestion items: workspace members first, then events
  // grouped under "Upcoming" / "Recent". BlockNote renders groups in
  // insertion order.
  const getAtMentionItems = async (query: string) => {
    const [members, events] = await Promise.all([
      getMemberItems(query),
      getEventItems(query),
    ]);
    return [...members, ...events];
  };

  // Track cell ref removals and clean up orphaned cache entries.
  // Keys come in as `<spreadsheetId>|<stableRef>`.
  const onCellRefsRemoved = (removed: Set<string>) => {
    for (const key of removed) {
      const sep = key.indexOf("|");
      const spreadsheetId = key.slice(0, sep) as Id<"spreadsheets">;
      const stableRef = key.slice(sep + 1);
      void removeCellRef({ spreadsheetId, stableRef });
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

  // Track @event mentions in parallel: sync to edges (mention graph). The
  // mutation diffs user/event edges independently — passing one array
  // leaves the other type untouched.
  const onEventMentionsChanged = (current: Set<string>) => {
    if (!document) return;
    void syncMentionEdges({
      sourceType: "document",
      sourceId: documentId,
      mentionedEventIds: [...current],
      workspaceId: document.workspaceId,
    });
  };
  useEditorTracking(editor, extractEventMentions, {
    onChanged: onEventMentionsChanged,
    syncOnMount: true,
  });

  // Sync hard-embed references (diagrams, spreadsheets, documents) to edges table
  const onEmbedsChanged = (current: Set<string>) => {
    if (!document) return;
    const references = [...current].map((key) => {
      // "type|id" or, for diagram embeds, "diagram|id|frameId" ("" = whole).
      const [targetType, targetId, frameId] = key.split("|");
      return {
        targetType: targetType as "diagram" | "spreadsheet" | "document",
        targetId,
        frameId: frameId || undefined,
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
  const [backlinksOpen, setBacklinksOpen] = useState(false);

  // Protect referenced blocks from accidental deletion
  const onReferencedBlocksDeleted = (blockIds: string[]) => {
    for (const blockId of blockIds) {
      void removeBlockRef({ documentId, blockId });
    }
  };
  useReferencedBlockDeleteProtection(editor, referencedBlockIds, onReferencedBlocksDeleted);

  // Cold-start snapshot fallback: offline + no editor from IndexedDB
  const { isColdStart, snapshotDoc } = useSnapshotFallback({
    isOffline,
    hasContent: !!editor,
    resourceType: "doc",
    resourceId: documentId,
  });

  // Suggestion menu items (#-trigger) and insert handlers
  const { getHashItems, handleCellRefInsert, handleBlockPickerInsert, handleFramePickerInsert } = useDocumentSuggestions({
    recents,
    searchResults,
    hasSearch: hasHashSearch,
    isStale: isHashSearchStale,
    editor,
    ensureCellRef,
    ensureBlockRef,
    setCellRefDialog,
    setBlockPickerDialog,
    setFramePickerDialog,
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
    <CommentsUIProvider>
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
          <button
            type="button"
            onClick={() => setBacklinksOpen((open) => !open)}
            disabled={!hasReferencedBlocks}
            aria-pressed={backlinksOpen}
            className={cn(
              "inline-flex items-center justify-center rounded-md p-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none",
              backlinksOpen
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            title={
              !hasReferencedBlocks
                ? "No referenced blocks"
                : backlinksOpen
                  ? "Hide referenced blocks"
                  : "Show referenced blocks"
            }
          >
            <Link2 className="size-4" />
          </button>
          {commentsEnabled && <CommentsToggleButton />}
          {document && (
            <DocumentActionsMenu
              documentId={documentId}
              documentName={document.name}
              isAdmin={isAdmin}
              editor={editor}
            />
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
      <div className="flex-1 flex flex-col min-h-0 relative">
        {SHOW_EDITOR_REVEAL_RIPPLE && <EditorRevealRipple />}
        {/*
          BlockNoteView is the outer flex container so the comments rail can sit
          beside the editor while still living inside BlockNoteView's React
          context (the rail's `useThreads`/`Thread` need both the editor context
          and the shadcn components context that BlockNoteView provides).
          `renderEditor={false}` + `<BlockNoteViewEditor />` lets us place the
          editor in our own scrollable column; `comments={false}` disables the
          default floating thread UI in favour of the rail — but it also removes
          the floating composer, so `<FloatingComposerController />` is added
          back manually or comment creation breaks.
        */}
        <BlockNoteView
          editor={editor}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          renderEditor={false}
          comments={false}
          className="flex-1 min-h-0 flex overflow-hidden"
        >
        <div
          ref={editorScrollRef}
          data-editor-scroll
          className="flex-1 min-w-0 scrollbar-autohide pt-4"
          onMouseDown={(e) => {
            // Clicking the empty editor padding (side margins / below the last
            // block) should drop the caret at the end of the document rather
            // than reset it to the first block. BlockNote's `editor.focus()`
            // alone lands at the top, so we position the caret explicitly first.
            //
            // Whitelist the padding rather than blacklisting BlockNote UI: now
            // that BlockNoteView is the outer container, every click is inside
            // its `.bn-root`, and the editor's floating UI (toolbar, composer,
            // menus) bubbles here through the React tree. So only act when the
            // target is the scroll container itself or the spotlight-frame
            // wrapper — never the editor content or any BlockNote control.
            const target = e.target as HTMLElement;
            const isPadding =
              target.dataset.editorScroll !== undefined ||
              target.classList.contains("document-spotlight-frame");
            if (!isPadding) return;
            e.preventDefault();
            const blocks = editor.document;
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock) {
              editor.setTextCursorPosition(lastBlock, "end");
            }
            editor.focus();
          }}
        >
        <DocumentSpotlightFrame>
          <ReferencedBlocksHighlight blockIds={referencedBlockIds} />
          <BlockNoteViewEditor />
          {cellRefDialog && (
            <CellRefDialog
              open={cellRefDialog.open}
              onOpenChange={(open) => {
                if (!open) setCellRefDialog(null);
              }}
              spreadsheetId={cellRefDialog.spreadsheetId}
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
          {framePickerDialog && (
            <FramePickerDialog
              open={framePickerDialog.open}
              onOpenChange={(open) => {
                if (!open) setFramePickerDialog(null);
              }}
              diagramId={framePickerDialog.diagramId}
              diagramName={framePickerDialog.diagramName}
              onInsert={(frameId) => {
                if (!framePickerDialog) return;
                handleFramePickerInsert(frameId, framePickerDialog);
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
        </DocumentSpotlightFrame>
        </div>
        {commentsEnabled && !isMobile && <CommentsDockedRail editor={editor} />}
        <SuggestionMenuController triggerCharacter={"#"} getItems={getHashItems} />
        <SuggestionMenuController triggerCharacter={"@"} getItems={getAtMentionItems} />
        {commentsEnabled && <CommentCountReporter />}
        {commentsEnabled && <CommentPendingWatcher editor={editor} />}
        {commentsEnabled && isMobile && <CommentsDrawer editor={editor} />}
        </BlockNoteView>
      </div>
    </div>
    </CommentsUIProvider>
  );
}
