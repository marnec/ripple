import { createReactInlineContentSpec } from "@blocknote/react";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useParams } from "react-router-dom";
import { useDiagramPreview } from "@/hooks/use-diagram-preview";

export const DiagramEmbed = createReactInlineContentSpec(
  {
    type: "diagramEmbed",
    propSchema: {
      diagramId: {
        default: "" as unknown as string,
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { diagramId } = inlineContent.props;
      if (!diagramId) {
        return (
          <span className="text-muted-foreground italic">#deleted-diagram</span>
        );
      }
      return <DiagramEmbedView diagramId={diagramId as Id<"diagrams">} />;
    },
  }
);

const DiagramEmbedView = ({ diagramId }: { diagramId: Id<"diagrams"> }) => {
  const { svgHtml, isLoading, diagram } =
    useDiagramPreview(diagramId);
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const handleClick = () => {
    if (diagram && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`);
    }
  };

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (diagram === null) {
    return (
      <span className="text-muted-foreground italic">#deleted-diagram</span>
    );
  }

  if (svgHtml) {
    return (
      <div
        className="my-2 border rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-40"
        contentEditable={false}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    );
  }

  return (
    <div
      className="my-2 border rounded-lg p-2 cursor-pointer hover:bg-muted/50 transition-colors h-20 flex items-center justify-center text-muted-foreground text-sm"
      contentEditable={false}
      onClick={handleClick}
    >
      Click to view diagram
    </div>
  );
};
