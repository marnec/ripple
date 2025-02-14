import { BlockNoteView } from "@blocknote/shadcn";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { api } from "../../../convex/_generated/api";
import { useParams } from "react-router-dom";
import { QueryParams } from "@/types";
import { useEffect, useState } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { useQuery } from "convex/react";
import { Id } from "../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../ui/loading-spinner";

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

  useEffect(() => {
    const setUpEditor = async () => {
      if (sync.isLoading) return;

      if (!sync.editor) {
        await sync.create({ type: "doc", content: [] });
      }

      setEditor(sync.editor);
    };

    setUpEditor();
  }, [sync, documentId]);



  return (
    <>
    {editor && <div className="px-20 flex-1 animate-fade-in">
      <h2 className="text-3xl py-12 font-semibold">{document?.name}</h2>
      <BlockNoteView editor={editor} />
    </div>}
    </>
  );
}
