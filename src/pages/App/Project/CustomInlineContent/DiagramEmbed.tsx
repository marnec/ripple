import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { exportToSvg } from "@excalidraw/excalidraw";
import { useEffect, useState } from "react";
import {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { AppState } from "@excalidraw/excalidraw/types";
import { useSanitize } from "@/hooks/use-sanitize";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "next-themes";
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
  const [svg, setSvg] = useState<string | null>(null);
  const sanitize = useSanitize();
  const sanitizedSvg = svg ? sanitize(svg) : "";
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const parsedElements = (() => {
    if (!diagram?.content) return null;
    try {
      const scene = JSON.parse(diagram.content);
      const elements = (scene.elements as NonDeleted<ExcalidrawElement>[]).filter(
        (e) => e.isDeleted !== true
      );
      return elements.length > 0 ? elements : null;
    } catch (e) {
      console.error("Failed to parse diagram", e);
      return null;
    }
  })();

  const isDiagramEmpty =
    diagram !== undefined && diagram !== null && !parsedElements;

  useEffect(() => {
    if (!parsedElements) return;
    let cancelled = false;
    const isDarkMode = resolvedTheme === "dark";
    const appState: Partial<AppState> = {
      theme: isDarkMode ? "dark" : "light",
      exportBackground: false,
      exportWithDarkMode: isDarkMode,
      exportEmbedScene: true,
    };
    exportToSvg({
      elements: parsedElements,
      appState,
      files: {},
      exportingFrame: null,
    })
      .then((svgElement: SVGSVGElement) => {
        if (cancelled) return;
        svgElement.setAttribute("width", "100%");
        svgElement.setAttribute("height", "100%");
        const svgString = svgElement.outerHTML.replace(
          /font-family: Virgil/g,
          'font-family: "Virgil, Segoe UI Emoji"'
        );
        setSvg(svgString);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to render diagram", e);
      });
    return () => {
      cancelled = true;
    };
  }, [parsedElements, resolvedTheme]);

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
  if (isDiagramEmpty) {
    return (
      <div
        className="my-2 border rounded-lg p-2 cursor-pointer hover:bg-muted/50 transition-colors h-40 flex items-center justify-center text-muted-foreground"
        contentEditable={false}
        onClick={handleClick}
      >
        Empty diagram
      </div>
    );
  }
  if (!svg || !sanitizedSvg) return <Skeleton className="h-20 w-full" />;

  return (
    <div
      className="my-2 border rounded-lg p-2 cursor-pointer hover:bg-muted/50 transition-colors h-40 overflow-hidden"
      contentEditable={false}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
};
