import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import FacePile from "@convex-dev/presence/facepile";
import usePresence from "@convex-dev/presence/react";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { QueryParams } from "@shared/types/routes";

export function DocumentEditorContainer() {
  const { documentId } = useParams<QueryParams>();

  if (!documentId) {
    return <p className="p-20">No document selected</p>;
  }

  return <DocumentEditor documentId={documentId} key={documentId} />;
}

export function DocumentEditor({ documentId }: { documentId: Id<"documents"> }) {
  const [editor, setEditor] = useState<BlockNoteEditor | null>(null);
  const sync = useBlockNoteSync(api.prosemirror, documentId);
  const document = useQuery(api.documents.get, { id: documentId });
  const viewer = useQuery(api.users.viewer);
  const presenceState = usePresence(api.presence, documentId, viewer?.name ?? "Anonymous");

  useEffect(() => {
    const setUpEditor = async () => {
      if (sync.isLoading) return;

      if (!sync.editor) {
        await sync.create({ type: "doc", content: [] });
        return;
      }

      setEditor(sync.editor as unknown as BlockNoteEditor);
    };

    setUpEditor();
  }, [sync, documentId]);

  return (
    <>
      {editor && (
        <div className="px-20 max-w-full flex-1 animate-fade-in relative">
          <div className="absolute top-12 right-20 z-10">
            <FacePile presenceState={presenceState ?? []} />
          </div>
          <h2 className="text-3xl py-12 font-semibold">{document?.name}</h2>
          <BlockNoteView editor={editor} />
        </div>
      )}
    </>
  );
}
