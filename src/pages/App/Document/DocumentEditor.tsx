import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import {
  SuggestionMenuController
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { PenTool } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../../../components/ui/avatar";
import { FacePile } from "../../../components/ui/facepile";
import { useEnhancedPresence } from "../../../hooks/use-enhanced-presence";
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

type Editor = BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema>;

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const { resolvedTheme } = useTheme();
  const [editor, setEditor] = useState<Editor | null>(null);
  const sync = useBlockNoteSync<Editor>(api.prosemirror, documentId, {
    editorOptions: {
      schema,
    },
  });
  const document = useQuery(api.documents.get, { id: documentId });
  const diagrams = useQuery(
    api.diagrams.list,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const workspaceMembers = useQuery(
    api.workspaceMembers.membersByWorkspace,
    document ? { workspaceId: document.workspaceId } : "skip"
  );
  const enhancedPresence = useEnhancedPresence(documentId);

  useEffect(() => {
    const setUpEditor = async () => {
      if (sync.isLoading) return;

      if (!sync.editor) {
        await sync.create({ type: "doc", content: [] });
        return;
      }

      setEditor(sync.editor);
    };

    void setUpEditor();
  }, [sync, documentId]);

  return (
    <>
      {editor && (
        <div className="px-20 max-w-full flex-1 animate-fade-in relative">
          <div className="absolute top-5 right-10 z-10">
            <FacePile users={enhancedPresence} hideInactive={true} />
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
      )}
    </>
  );
}
