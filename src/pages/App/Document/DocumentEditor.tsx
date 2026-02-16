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
import { useQuery } from "convex/react";
import { PenTool } from "lucide-react";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
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
import { ConnectionStatus } from "./ConnectionStatus";
import { DiagramBlock } from "./CustomBlocks/DiagramBlock";
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
  },
});

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
  const workspaceMembers = useQuery(
    api.workspaceMembers.membersByWorkspace,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const viewer = useQuery(api.users.viewer);

  const { editor, isLoading, isConnected, isOffline, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

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
        Y.applyUpdate(tempDoc, new Uint8Array(arrayBuffer));
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
        <div className="sticky top-0 z-10 flex items-center justify-end gap-3 pt-5 pb-2 bg-background/80 backdrop-blur-sm">
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
        <h2 className="text-3xl pb-12 font-semibold">{document?.name}</h2>
        <BlockNoteView editor={editor} theme={resolvedTheme === "dark" ? "dark" : "light"}>
              <SuggestionMenuController
                triggerCharacter={"#"}
                getItems={async (query) => {
                  if (!diagrams) return [];
                  return diagrams
                    .map((diagram) => ({
                      title: diagram.name,
                      onItemClick: () => {
                        editor.insertBlocks(
                          [
                            {
                              type: "diagram",
                              props: {
                                diagramId: diagram._id,
                              },
                            },
                          ],
                          editor.getTextCursorPosition().block,
                          "after"
                        );
                      },
                      icon: <PenTool />,
                      group: "Workspace diagrams",
                      key: diagram._id,
                    }))
                    .filter((item) =>
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
      </div>
    </div>
  );
}
