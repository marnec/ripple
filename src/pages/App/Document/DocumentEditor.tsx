import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
} from "@blocknote/core";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { useQuery } from "convex/react";
import { CircleSlashed, PenTool } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { QueryParams } from "@shared/types/routes";
import { useEnhancedPresence } from "../../../hooks/use-enhanced-presence";
import { FacePile } from "../../../components/ui/facepile";
import { DiagramBlock } from "./DiagramBlock";

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
    diagram: DiagramBlock,
  },
});

type Editor = BlockNoteEditor<typeof schema.blockSchema>;

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
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
  const enhancedPresence = useEnhancedPresence(documentId);

  useEffect(() => {
    const setUpEditor = async () => {
      if (sync.isLoading) return;

      if (!sync.editor) {
        await sync.create({ type: "doc", content: [] });
        return;
      }

      setEditor(sync.editor as Editor);
    };

    setUpEditor();
  }, [sync, documentId]);

  return (
    <>
      {editor && (
        <div className="px-20 max-w-full flex-1 animate-fade-in relative">
          <div className="absolute top-5 right-10 z-10">
            <FacePile users={enhancedPresence} hideInactive={true} />
          </div>
          <h2 className="text-3xl py-12 font-semibold">{document?.name}</h2>
          <BlockNoteView editor={editor}>
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
          </BlockNoteView>
        </div>
      )}
    </>
  );
}
