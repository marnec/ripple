import { useDocumentBlockPreview } from "@/hooks/use-document-block-preview";
import { defaultProps, type BlockConfig } from "@blocknote/core";
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { CircleSlash } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

function DocumentBlockView({
  documentId,
  blockId,
}: {
  documentId: Id<"documents">;
  blockId: string;
}) {
  const document = useQuery(api.documents.get, { id: documentId });
  const { blockType, textContent, isLoading } = useDocumentBlockPreview(documentId, blockId);
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const handleClick = () => {
    if (document && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/documents/${documentId}`);
    }
  };

  // Document deleted
  if (document === null) {
    return (
      <div data-embed-deleted className="w-full flex flex-col items-center justify-center p-4 border rounded-lg text-center text-muted-foreground bg-secondary h-20 gap-2">
        <CircleSlash className="h-6 w-6 text-destructive" />
        <p className="text-destructive text-sm">Document not found. It may have been deleted.</p>
      </div>
    );
  }

  // Loading — mirror the loaded DOM structure invisibly to reserve exact dimensions
  if (document === undefined || isLoading) {
    return (
      <div aria-hidden="true" className="invisible">
        <div className="text-xs text-muted-foreground w-full text-right">&nbsp;</div>
        <div className="w-full border-l-3 border-primary/30 pl-3 py-2">
          <p className="text-sm leading-relaxed">&nbsp;</p>
        </div>
      </div>
    );
  }

  // Block content not found (block may have been deleted from source)
  if (!textContent) {
    return (
      <div data-embed-deleted className="w-full flex items-center gap-2 p-3 border border-dashed rounded-lg text-muted-foreground text-sm">
        <CircleSlash className="h-4 w-4 shrink-0" />
        <span>Referenced block no longer exists in &ldquo;{document.name}&rdquo;</span>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="text-xs text-muted-foreground w-full text-right">
        <span className="truncate max-w-60">{document.name}</span>
      </div>
      <div
        className="w-full border-l-3 border-primary/30 pl-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-r-md"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <p className={`text-sm leading-relaxed ${blockType === "heading" ? "font-semibold" : ""}`}>
          {textContent}
        </p>
      </div>
    </div>
  );
}

const documentBlockEmbedPropSchema = {
  textAlignment: defaultProps.textAlignment,
  documentId: {
    default: "" as unknown as string,
  },
  blockId: {
    default: "",
  },
  width: {
    default: 512,
  },
} as const;

type DocumentBlockEmbedProps = ReactCustomBlockRenderProps<
  BlockConfig<"documentBlockEmbed", typeof documentBlockEmbedPropSchema, "none">
>;

const DocumentBlockEmbedRenderer = ({ block }: DocumentBlockEmbedProps) => {
  const { documentId, blockId } = block.props;

  if (!documentId || !blockId) {
    return (
      <div className="p-3 border rounded-lg text-center text-muted-foreground text-sm">
        Invalid document block reference.
      </div>
    );
  }

  return (
    <div className="p-3 border rounded-lg">
      <DocumentBlockView
        documentId={documentId as Id<"documents">}
        blockId={blockId}
      />
    </div>
  );
};

export const DocumentBlockEmbed = createReactBlockSpec(
  {
    type: "documentBlockEmbed",
    propSchema: documentBlockEmbedPropSchema,
    content: "none",
  },
  {
    render: (props) => <DocumentBlockEmbedRenderer {...props} />,
  },
);
