import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import {
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import { PenTool, Table } from "lucide-react";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../../../components/ui/avatar";
import { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import { useCursorAwareness } from "../../../hooks/use-cursor-awareness";
import { getUserColor } from "../../../lib/user-colors";
import { ActiveUsers } from "./ActiveUsers";
import { CellRefDialog } from "./CellRefDialog";
import { ConnectionStatus } from "./ConnectionStatus";
import { DiagramBlock } from "./CustomBlocks/DiagramBlock";
import { SpreadsheetLink, SpreadsheetCellRef } from "./CustomBlocks/SpreadsheetRef";
import { User } from "./CustomBlocks/UserBlock";

export function DocumentEditorContainer() {
  const { documentId } = useParams<QueryParams>();

  if (!documentId) {
    return <p className="p-20">No document selected</p>;
  }

  return <DocumentEditor documentId={documentId} key={documentId} />;
}

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    diagram: DiagramBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: User,
    spreadsheetLink: SpreadsheetLink,
    spreadsheetCellRef: SpreadsheetCellRef,
  },
});

/** Extract all spreadsheetCellRef keys from the editor document tree. */
function extractCellRefs(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "spreadsheetCellRef" && ic.props) {
          refs.add(`${ic.props.spreadsheetId}|${ic.props.cellRef}`);
        }
      }
    }
    if (block.content?.type === "tableContent") {
      for (const row of block.content.rows) {
        for (const cell of row.cells) {
          for (const ic of cell.content) {
            if (ic.type === "spreadsheetCellRef" && ic.props) {
              refs.add(`${ic.props.spreadsheetId}|${ic.props.cellRef}`);
            }
          }
        }
      }
    }
    if (block.children) {
      for (const key of extractCellRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

// Snapshot fallback component for cold-start read-only mode
function SnapshotFallback({
  snapshotDoc,
  documentName,
  resolvedTheme,
}: {
  snapshotDoc: Y.Doc;
  documentName: string | undefined;
  resolvedTheme: string | undefined;
}) {
  const fragment = snapshotDoc.getXmlFragment("document-store");
  const fakeProvider = { awareness: new Awareness(snapshotDoc) } as any;

  const snapshotEditor = useCreateBlockNote({
    schema,
    collaboration: {
      fragment,
      provider: fakeProvider,
      user: { name: "", color: "" },
    },
  });

  return (
    <div className="h-full flex-1 min-w-0 overflow-y-scroll scrollbar-sleek">
      <div className="px-20 max-w-full animate-fade-in">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-3 pt-5 pb-2">
          <ConnectionStatus isConnected={false} />
        </div>
        <h2 className="text-3xl pb-12 font-semibold">{documentName}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Viewing saved version (offline)
        </p>
        <BlockNoteView
          editor={snapshotEditor}
          editable={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
        />
      </div>
    </div>
  );
}

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const { resolvedTheme } = useTheme();
  const document = useQuery(api.documents.get, { id: documentId });
  const diagrams = useQuery(
    api.diagrams.list,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const spreadsheets = useQuery(
    api.spreadsheets.list,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const workspaceMembers = useQuery(
    api.workspaceMembers.membersByWorkspace,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const viewer = useQuery(api.users.viewer);
  const ensureCellRef = useMutation(api.spreadsheetCellRefs.ensureCellRef);
  const removeCellRef = useMutation(api.spreadsheetCellRefs.removeCellRef);

  const [cellRefDialog, setCellRefDialog] = useState<{
    open: boolean;
    spreadsheetId: Id<"spreadsheets">;
    spreadsheetName: string;
  } | null>(null);

  const { editor, isLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  // Track cell ref removals and clean up orphaned cache entries
  const prevCellRefsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor) return;
    prevCellRefsRef.current = extractCellRefs(editor.document);

    const unsubscribe = editor.onChange(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const current = extractCellRefs(editor.document);
        for (const key of prevCellRefsRef.current) {
          if (!current.has(key)) {
            const sep = key.indexOf("|");
            const spreadsheetId = key.slice(0, sep) as Id<"spreadsheets">;
            const cellRef = key.slice(sep + 1);
            void removeCellRef({ spreadsheetId, cellRef });
          }
        }
        prevCellRefsRef.current = current;
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, removeCellRef]);

  // Cold-start snapshot fallback: offline + no editor from IndexedDB
  const isColdStart = isOffline && !editor;
  const snapshotUrl = useQuery(
    api.snapshots.getSnapshotUrl,
    isColdStart ? { resourceType: "doc", resourceId: documentId } : "skip"
  );

  const [snapshotDoc, setSnapshotDoc] = useState<Y.Doc | null>(null);

  // Fetch and apply snapshot when URL is available
  useEffect(() => {
    if (!snapshotUrl || !isColdStart) {
      return;
    }

    const loadSnapshot = async () => {
      try {
        const response = await fetch(snapshotUrl);
        const arrayBuffer = await response.arrayBuffer();
        const tempDoc = new Y.Doc();
        Y.applyUpdateV2(tempDoc, new Uint8Array(arrayBuffer));
        setSnapshotDoc(tempDoc);
      } catch (error) {
        console.error("Failed to load snapshot:", error);
      }
    };

    void loadSnapshot();

    // Cleanup when conditions change
    return () => {
      setSnapshotDoc(null);
    };
  }, [snapshotUrl, isColdStart]);

  // Show snapshot fallback in cold-start offline mode
  if (isColdStart && snapshotDoc) {
    return (
      <SnapshotFallback
        snapshotDoc={snapshotDoc}
        documentName={document?.name}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  if (isLoading || !editor) {
    return <div className="p-20 animate-pulse">Loading document...</div>;
  }

  return (
    <div className="h-full flex-1 min-w-0 overflow-y-scroll scrollbar-sleek">
      <div className="px-20 max-w-full animate-fade-in">
        <div className="sticky top-0 z-10 flex items-center justify-end pt-5 pb-2 bg-background/80 backdrop-blur-sm">
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
        <h2 className="text-3xl pb-12 font-semibold">{document?.name}</h2>
        <BlockNoteView editor={editor} theme={resolvedTheme === "dark" ? "dark" : "light"}>
              <SuggestionMenuController
                triggerCharacter={"#"}
                getItems={async (query) => {
                  const diagramItems = (diagrams ?? []).map((diagram) => ({
                    title: diagram.name,
                    onItemClick: () => {
                      editor.insertBlocks(
                        [
                          {
                            type: "diagram" as const,
                            props: { diagramId: diagram._id },
                          },
                        ],
                        editor.getTextCursorPosition().block,
                        "after"
                      );
                    },
                    icon: <PenTool className="h-4 w-4" />,
                    group: "Workspace diagrams",
                  }));

                  const spreadsheetItems = (spreadsheets ?? []).map((sheet) => ({
                    title: sheet.name,
                    onItemClick: () => {
                      setCellRefDialog({
                        open: true,
                        spreadsheetId: sheet._id,
                        spreadsheetName: sheet.name,
                      });
                    },
                    icon: <Table className="h-4 w-4" />,
                    group: "Spreadsheets",
                  }));

                  return [...diagramItems, ...spreadsheetItems].filter((item) =>
                    item.title.toLowerCase().includes(query.toLowerCase())
                  );
                }}
              />
              <SuggestionMenuController
                triggerCharacter={"@"}
                getItems={async (query: string) => {
                  if (!workspaceMembers) return [];
                  return workspaceMembers
                    .filter((member) =>
                      member.name?.toLowerCase().includes(query.toLowerCase())
                    )
                    .map((member) => ({
                      title: member.name ?? "Unknown User",
                      onItemClick: () => {
                        editor.insertInlineContent([
                          {
                            type: "mention",
                            props: {
                              userId: member._id,
                            },
                          },
                          " ",
                        ]);
                      },
                      icon: (
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={member.image} />
                          <AvatarFallback>
                            {member.name?.charAt(0).toLocaleUpperCase() || "U"}
                          </AvatarFallback>
                        </Avatar>
                      ),
                      group: "Workspace members",
                      key: member._id,
                    }));
                }}
              />
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
              const { spreadsheetId } = cellRefDialog;
              editor.focus();
              if (cellRef) {
                editor.insertInlineContent([
                  {
                    type: "spreadsheetCellRef",
                    props: { spreadsheetId, cellRef },
                  },
                  " ",
                ]);
                void ensureCellRef({ spreadsheetId, cellRef });
              } else {
                editor.insertInlineContent([
                  {
                    type: "spreadsheetLink",
                    props: { spreadsheetId },
                  },
                  " ",
                ]);
              }
              setCellRefDialog(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
