import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useParams } from "react-router-dom";

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
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  // Check if SVG preview is available
  const hasSvgPreview = diagram !== undefined && diagram !== null && !!diagram.svgPreview;
  const isDiagramEmpty = diagram !== undefined && diagram !== null && !hasSvgPreview;

  const handleClick = () => {
    if (diagram && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`);
    }
  };

  if (diagram === undefined) return <Skeleton className="h-20 w-full" />;
  if (diagram === null) {
    return (
      <span className="text-muted-foreground italic">#deleted-diagram</span>
    );
  }
  if (hasSvgPreview && diagram.svgPreview) {
    return (
      <div
        className="my-2 border rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-40"
        contentEditable={false}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: diagram.svgPreview }}
      />
    );
  }
  if (isDiagramEmpty) {
    return (
      <div
        className="my-2 border rounded-lg p-2 cursor-pointer hover:bg-muted/50 transition-colors h-20 flex items-center justify-center text-muted-foreground text-sm"
        contentEditable={false}
        onClick={handleClick}
      >
        Click to view diagram
      </div>
    );
  }

  return null;
};
