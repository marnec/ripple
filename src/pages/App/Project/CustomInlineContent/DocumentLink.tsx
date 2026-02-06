import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

export const DocumentLink = createReactInlineContentSpec(
  {
    type: "documentLink",
    propSchema: {
      documentId: {
        default: "" as unknown as string,
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { documentId } = inlineContent.props;
      if (!documentId) {
        return (
          <span className="text-muted-foreground italic">#deleted-document</span>
        );
      }
      return <DocumentLinkView documentId={documentId as Id<"documents">} />;
    },
  }
);

const DocumentLinkView = ({ documentId }: { documentId: Id<"documents"> }) => {
  const document = useQuery(api.documents.get, { id: documentId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (document && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/documents/${documentId}`);
    }
  };

  if (document === undefined) {
    return <Skeleton className="h-5 w-24 rounded inline-block align-middle" />;
  }

  if (document === null) {
    return (
      <span className="text-muted-foreground italic align-middle">
        #deleted-document
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors align-middle"
      contentEditable={false}
      onClick={handleClick}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[200px] truncate">{document.name}</span>
    </span>
  );
};
