import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import {
  SuggestionMenuController
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { PenTool } from "lucide-react";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
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

  const { editor, isLoading, isConnected, provider } = useDocumentCollaboration({
    documentId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
    schema,
  });

  const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null);

  if (isLoading || !editor) {
    return <div className="p-20 animate-pulse">Loading document...</div>;
  }

  return (
    <div className="px-20 max-w-full flex-1 animate-fade-in relative">
      <div className="absolute top-5 right-10 z-10 flex items-center gap-3">
        <ConnectionStatus isConnected={isConnected} provider={provider} />
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
      </div>
      <h2 className="text-3xl py-12 font-semibold">{document?.name}</h2>
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
  );
}
