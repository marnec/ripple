import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { DocumentActionsMenu } from "./DocumentActionsMenu";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAutoHideScrollbar } from "@/hooks/use-autohide-scrollbar";
import {
  BlockNoteViewEditor,
  SuggestionMenuController,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useLocation, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useViewer } from "../UserContext";
import { useLocalRecents } from "@/hooks/use-local-recents";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import {
  CollaborativeSurface,
  type HydratedSurface,
} from "@/components/CollaborativeSurface";
import { SurfaceHeader } from "@/components/SurfaceHeader";
import { useResourceDoc } from "@/hooks/use-collab-session";
import { SurfaceActiveUsers } from "@/components/SurfaceActiveUsers";
import type { BlockNoteEditor } from "@blocknote/core";

// The WebGL "reveal ripple" that fired on clicks outside the editor is disabled
// — editor-boundary detection is now handled by the caret-guard whitelist + the
// spotlight frame, so the ripple is purely decorative and was distracting. Kept
// behind a flag (not deleted) because the effect is complex and may be reused
// elsewhere; flip to `true` to bring it back.
const SHOW_EDITOR_REVEAL_RIPPLE = false;

const documentDictionary = {
  ...richTextDictionary,
  placeholders: {
    ...richTextDictionary.placeholders,
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
import { useUploadFile } from "../../../hooks/use-upload-file";
import { BlockPickerDialog } from "./BlockPickerDialog";
import { CellRefDialog } from "./CellRefDialog";
import { FramePickerDialog } from "./FramePickerDialog";
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
import { richTextDictionary } from "@/lib/blocknote/rich-text-schema";
import { getRichSlashMenuItems } from "@/lib/blocknote/slash-menu";
import { SUGGESTION_MENU_FLOATING_OPTIONS } from "@/lib/blocknote/floating";
import { useMediaDropGuard } from "@/hooks/use-media-drop-guard";
import { documentSchema as schema } from "./schema";
import { useDocumentSuggestions } from "./useDocumentSuggestions";

export function DocumentEditorContainer() {
  const { documentId } = useParams<QueryParams>();

  if (!documentId) {
    return <SomethingWentWrong />;
  }

  return <DocumentEditor documentId={documentId} key={documentId} />;
}

/** What the header renders for a document. */
interface DocumentMeta {
  name: string;
  tags?: string[];
}

type DocumentEditorInstance = BlockNoteEditor<any, any, any> | null;

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const { workspaceId } = useParams<QueryParams>();
  const viewer = useViewer();
  const liveDocument = useQuery(api.documents.get, { id: documentId });
  const myRole = useQuery(
    api.workspaceMembers.myRole,
    workspaceId ? { workspaceId } : "skip",
  );
  const isAdmin = myRole === "admin";
  const updateTags = useMutation(api.documents.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.documents.get),
  );

  // The comments extension only exists for a real viewer, so all comment UI
  // (toggle, rail, reporter) is gated on this.
  const commentsEnabled = !!viewer?._id;

  // Lifted out of the body the way the diagram lifts its canvas API: the
  // actions menu lives in the header, which renders above the editor that
  // creates it.
  const [editor, setEditor] = useState<DocumentEditorInstance>(null);

  // The room, opened here and handed to the sequence. Declared above the
  // workspace guard because hooks cannot sit after an early return.
  const doc = useResourceDoc({ resourceType: "doc", resourceId: documentId });

  if (!workspaceId) {
    return <SomethingWentWrong />;
  }

  return (
    <CommentsUIProvider>
      <CollaborativeSurface<DocumentMeta>
        resourceType="doc"
        doc={doc}
        meta={liveDocument}
      >
        {(surface) => (
          <>
            <SurfaceHeader
              surface={surface}
              resourceType="doc"
              resourceId={documentId}
              workspaceId={workspaceId}
              onTagsChange={(tags) => void updateTags({ id: documentId, tags })}
              settingsTitle="Document settings"
              focusable
              activeUsers={(awareness) => (
                <SurfaceActiveUsers awareness={awareness} viewer={viewer} />
              )}
              /* Threads live in the Y.Doc, so commenting works offline too. */
              tools={commentsEnabled ? <CommentsToggleButton /> : undefined}
              actions={(meta) => (
                <DocumentActionsMenu
                  documentId={documentId}
                  documentName={meta.name}
                  isAdmin={isAdmin}
                  editor={editor}
                />
              )}
            />
            <DocumentBody
              surface={surface}
              documentId={documentId}
              workspaceId={workspaceId}
              commentsEnabled={commentsEnabled}
              onEditorReady={setEditor}
            />
          </>
        )}
      </CollaborativeSurface>
    </CommentsUIProvider>
  );
}

/**
 * The document itself, bound to a replica that is known to hold it. Mounted by
 * `CollaborativeSurface` only once that is true.
 */
function DocumentBody({
  surface,
  documentId,
  workspaceId,
  commentsEnabled,
  onEditorReady,
}: {
  surface: HydratedSurface<DocumentMeta>;
  documentId: Id<"documents">;
  workspaceId: Id<"workspaces">;
  commentsEnabled: boolean;
  onEditorReady: (editor: DocumentEditorInstance) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const location = useLocation();
  const viewer = useViewer();
  const importedHTML = (location.state as { importedHTML?: string } | null)?.importedHTML;
  const importInjectedRef = useRef(false);

  // Keyed off the route, not the document row: `useUploadFile` reads the
  // workspace from a ref at call time.
  const fileUpload = useUploadFile(workspaceId);

  const { editor } = useDocumentCollaboration({
    doc: surface.doc,
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
    uploadFile: fileUpload?.uploadFile,
    dictionary: documentDictionary,
    enableComments: commentsEnabled,
  });

  // Hand the editor up so the header's actions menu can reach it.
  useEffect(() => {
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  const [hashSearch, setHashSearch] = useState("");
  const [debouncedHashSearch, setDebouncedHashSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHashSearch(hashSearch), 200);
    return () => clearTimeout(timer);
  }, [hashSearch]);

  const hasHashSearch = debouncedHashSearch.trim().length > 0;
  const isHashSearchStale = hashSearch !== debouncedHashSearch;

  const recents = useLocalRecents(hasHashSearch ? undefined : workspaceId, 10);
  const searchResults = useQuery(
    api.nodes.search,
    hasHashSearch ? { workspaceId, searchText: debouncedHashSearch } : "skip",
  );
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, {
    workspaceId,
  });
  const ensureCellRef = useMutation(api.spreadsheetCellRefs.ensureCellRef);
  const removeCellRef = useMutation(api.spreadsheetCellRefs.removeCellRef);
  const ensureBlockRef = useMutation(api.documentBlockRefs.ensureBlockRef);
  const removeBlockRef = useMutation(api.documentBlockRefs.removeBlockRef);
  const syncEdges = useMutation(api.edges.syncEdges);
  const syncMentionEdges = useMutation(api.edges.syncMentionEdges);
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


  // Editor scroll container: scrollbar appears only while scrolling, then fades.
  const editorScrollRef = useAutoHideScrollbar<HTMLDivElement>();

  // Documents take images, not attachments — see `rich-text-schema.ts`. The
  // guard sits on the scroll container so it captures the drop before
  // ProseMirror's own listener on the editor node sees it.
  const mediaDropGuard = useMediaDropGuard(
    "Documents take images only — files, audio and video can't be embedded.",
  );

  // Inject imported content (from .docx import) once when the editor is ready
  useEffect(() => {
    if (!editor || !importedHTML || importInjectedRef.current) return;
    importInjectedRef.current = true;
    const blocks = editor.tryParseHTMLToBlocks(importedHTML);
    editor.replaceBlocks(editor.document, blocks);
    window.history.replaceState({}, "");
  }, [editor, importedHTML]);

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
    mentionType: "mention",
  });

  const getEventItems = useEventSuggestions({
    workspaceId: workspaceId,
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
    void syncMentionEdges({
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [...current],
      workspaceId,
    });
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
    void syncMentionEdges({
      sourceType: "document",
      sourceId: documentId,
      mentionedEventIds: [...current],
      workspaceId,
    });
  };
  useEditorTracking(editor, extractEventMentions, {
    onChanged: onEventMentionsChanged,
    syncOnMount: true,
  });

  // Sync hard-embed references (diagrams, spreadsheets, documents) to edges table
  const onEmbedsChanged = (current: Set<string>) => {
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
      workspaceId,
    });
  };
  useEditorTracking(editor, extractHardEmbeds, {
    onChanged: onEmbedsChanged,
    syncOnMount: true,
  });

  // Protect embed blocks from accidental deletion with animation + undo toast
  useEmbedDeleteProtection(editor);

  // Track which blocks in this document are referenced by embeds elsewhere
  const { referencedBlockIds } = useReferencedBlocks(documentId);

  // Protect referenced blocks from accidental deletion
  const onReferencedBlocksDeleted = (blockIds: string[]) => {
    for (const blockId of blockIds) {
      void removeBlockRef({ documentId, blockId });
    }
  };
  useReferencedBlockDeleteProtection(editor, referencedBlockIds, onReferencedBlocksDeleted);

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

  if (!editor) {
    return <div className="h-full w-full flex-1 min-w-0" />;
  }

  return (
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
        /* Replaced below so the math items can join the defaults. */
        slashMenu={false}
        className="flex-1 min-h-0 flex overflow-hidden"
      >
      <div
        ref={editorScrollRef}
        data-editor-scroll
        className="flex-1 min-w-0 scrollbar-autohide pt-4"
        {...mediaDropGuard}
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
      </DocumentSpotlightFrame>
      </div>
      {commentsEnabled && !isMobile && <CommentsDockedRail editor={editor} />}
      <SuggestionMenuController
        triggerCharacter={"/"}
        getItems={(query) => getRichSlashMenuItems(editor, query)}
        floatingUIOptions={SUGGESTION_MENU_FLOATING_OPTIONS}
      />
      <SuggestionMenuController
        triggerCharacter={"#"}
        getItems={getHashItems}
        floatingUIOptions={SUGGESTION_MENU_FLOATING_OPTIONS}
      />
      <SuggestionMenuController
        triggerCharacter={"@"}
        getItems={getAtMentionItems}
        floatingUIOptions={SUGGESTION_MENU_FLOATING_OPTIONS}
      />
      {commentsEnabled && <CommentCountReporter />}
      {commentsEnabled && <CommentPendingWatcher editor={editor} />}
      {commentsEnabled && isMobile && <CommentsDrawer editor={editor} />}
      </BlockNoteView>
    </div>
  );
}
