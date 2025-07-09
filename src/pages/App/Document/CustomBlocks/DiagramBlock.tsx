import { createReactBlockSpec } from "@blocknote/react";
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
import { useSanitize } from "../../../../hooks/use-sanitize";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useTheme } from "next-themes";
import { CircleSlash } from "lucide-react";


const DiagramView = ({ diagramId }: { diagramId: Id<"diagrams"> }) => {
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const [svg, setSvg] = useState<string | null>(null);
  const sanitize = useSanitize();
  const sanitizedSvg = svg ? sanitize(svg) : "";
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (diagram && diagram.content) {
      try {
        const scene = JSON.parse(diagram.content);
        const elements = scene.elements as NonDeleted<ExcalidrawElement>[];
        if (!elements || elements.length === 0) {
          setSvg(""); // Mark as empty
          return;
        }
        const savedAppState = scene.appState || {};
        const isDarkMode = resolvedTheme === "dark";
        const appState: Partial<AppState> = {
          ...savedAppState,
          theme: isDarkMode ? "dark" : "light",
          exportBackground: false,
          exportWithDarkMode: isDarkMode,
          exportEmbedScene: true,
        };

        exportToSvg({
          elements,
          appState,
          files: {},
        }).then((svgElement: SVGSVGElement) => {
          // Excalidraw's export function can leave the font as "Virgil", but the web-font is "Virgil, Segoe UI Emoji"
          // We need to replace it to make sure the font is rendered correctly.
          const svgString = svgElement.outerHTML.replace(
            /font-family: Virgil/g,
            'font-family: "Virgil, Segoe UI Emoji"',
          );
          setSvg(svgString);
        });
      } catch (e) {
        setSvg(""); // Mark as empty on error
        console.error("Failed to parse or render diagram", e);
      }
    } else if (diagram) {
      setSvg(""); // Mark as empty
    }
  }, [diagram, resolvedTheme]);

  if (diagram === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (diagram === null) {
    return (
      <div className="w-full flex flex-col items-center justify-center p-4 border rounded-lg text-center text-gray-500 bg-secondary h-40 gap-2">
        <CircleSlash className="h-10 w-10 text-destructive" />
        <p className="text-destructive">
          Diagram not found. It may have been deleted.
        </p>
      </div>
    );
  }

  if (svg === "") {
    return (
      <div className="w-full flex flex-col items-center justify-center p-4 text-center text-gray-500 bg-secondary h-40 gap-2">
        <p>This diagram is empty.</p>
        <p className="text-sm">Edit the diagram to add content.</p>
      </div>
    );
  }

  if (!svg || !sanitizedSvg) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div
      className="w-full flex items-center justify-center"
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
};

export const DiagramBlock = createReactBlockSpec(
  {
    type: "diagram",
    propSchema: {
      diagramId: {
        default: null as unknown as Id<"diagrams">,
      },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const { diagramId } = block.props;

      if (!diagramId) {
        return (
          <div className="p-4 border rounded-lg text-center text-gray-500">
            <p>Please select a diagram to display.</p>
          </div>
        );
      }
      return (
        <div className="p-4 border rounded-lg">
          <DiagramView diagramId={diagramId as Id<"diagrams">} />
        </div>
      );
    },
  },
); 