import {
  createReactBlockSpec,
  ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { exportToSvg } from "@excalidraw/excalidraw";
import { useEffect, useRef, useState } from "react";
import {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { AppState } from "@excalidraw/excalidraw/types";
import { useSanitize } from "../../../../hooks/use-sanitize";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useTheme } from "next-themes";
import { CircleSlash } from "lucide-react";
import { defaultProps } from "@blocknote/core";

const DiagramView = ({
  diagramId,
  onAspectRatioChange,
}: {
  diagramId: Id<"diagrams">;
  onAspectRatioChange?: (ratio: number) => void;
}) => {
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const [svg, setSvg] = useState<string | null>(null);
  const sanitize = useSanitize();
  const sanitizedSvg = svg ? sanitize(svg) : "";
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (diagram && diagram.content) {
      try {
        const scene = JSON.parse(diagram.content);
        
        const elements = (scene.elements as NonDeleted<ExcalidrawElement>[])
          .filter((e) => e.isDeleted !== true);

        if (!elements || elements.length === 0) {
          setSvg(""); // Mark as empty
          return;
        }
        const isDarkMode = resolvedTheme === "dark";
        const appState: Partial<AppState> = {
          theme: isDarkMode ? "dark" : "light",
          exportBackground: false,
          exportWithDarkMode: isDarkMode,
          exportEmbedScene: true,
        };

        exportToSvg({
          elements,
          appState,
          files: {},
          exportingFrame: null,
        }).then((svgElement: SVGSVGElement) => {
          const svgWidth = parseFloat(svgElement.getAttribute("width") || "0");
          const svgHeight = parseFloat(svgElement.getAttribute("height") || "0");
          if (onAspectRatioChange && svgWidth > 0 && svgHeight > 0) {
            onAspectRatioChange(svgHeight / svgWidth);
          }
          svgElement.setAttribute("width", "100%");
          svgElement.setAttribute("height", "100%");
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
  }, [diagram, resolvedTheme, onAspectRatioChange]);

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
      className="w-full h-full"
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
};

const ResizableDiagram = ({ block, editor }: any) => {
  const { diagramId } = block.props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const resizeParamsRef = useRef<{
    handleUsed: "l" | "r";
    initialWidth: number;
    initialClientX: number;
  }>();

  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  // state to show/hide handles
  const [showHandles, setShowHandles] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const windowMouseMoveHandler = (event: MouseEvent) => {
      if (!resizeParamsRef.current) {
        return;
      }

      let newWidth: number;
      const resizeParams = resizeParamsRef.current;
      const xDiff = event.clientX - resizeParams.initialClientX;

      if (block.props.textAlignment === "center") {
        if (resizeParams.handleUsed === "r") {
          newWidth = resizeParams.initialWidth + xDiff * 2;
        } else {
          newWidth = resizeParams.initialWidth - xDiff * 2;
        }
      } else {
        if (resizeParams.handleUsed === "r") {
          newWidth = resizeParams.initialWidth + xDiff;
        } else {
          newWidth = resizeParams.initialWidth - xDiff;
        }
      }

      const minWidth = 64;
      const editorWidth = (editor.domElement?.firstElementChild as HTMLElement)
        ?.clientWidth;

      const finalWidth = Math.min(
        Math.max(newWidth, minWidth),
        editorWidth || Number.MAX_VALUE,
      );
      wrapper.style.width = `${finalWidth}px`;
      if (aspectRatio) {
        wrapper.style.height = `${finalWidth * aspectRatio}px`;
      }
    };

    const windowMouseUpHandler = () => {
      if (!resizeParamsRef.current) {
        return;
      }

      resizeParamsRef.current = undefined;

      editor.updateBlock(block, {
        props: {
          width: wrapper.clientWidth,
        },
      });
    };

    window.addEventListener("mousemove", windowMouseMoveHandler);
    window.addEventListener("mouseup", windowMouseUpHandler);

    return () => {
      window.removeEventListener("mousemove", windowMouseMoveHandler);
      window.removeEventListener("mouseup", windowMouseUpHandler);
    };
  }, [editor, block, aspectRatio]);

  const resizeHandleMouseDownHandler = (
    event: React.MouseEvent,
    handle: "l" | "r",
  ) => {
    event.preventDefault();
    if (!wrapperRef.current) return;
    resizeParamsRef.current = {
      handleUsed: handle,
      initialWidth: wrapperRef.current.clientWidth,
      initialClientX: event.clientX,
    };
  };

  if (!diagramId) {
    return (
      <div className="p-4 border rounded-lg text-center text-gray-500">
        <p>Please select a diagram to display.</p>
      </div>
    );
  }

  const resizeHandleStyle: React.CSSProperties = {
    position: "absolute",
    width: "8px",
    height: "40px",
    backgroundColor: "black",
    borderRadius: "4px",
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'white',
    zIndex: 10,
  };

  return (
    <div
      {...block.contentAttributes}
      ref={wrapperRef}
      className="relative"
      style={{
        width: block.props.width,
        height:
          aspectRatio && block.props.width
            ? `${block.props.width * aspectRatio}px`
            : "auto",
      }}
      onMouseEnter={() => editor.isEditable && setShowHandles(true)}
      onMouseLeave={(event) => {
        if (
          (event.relatedTarget as HTMLElement)?.classList.contains(
            "bn-resize-handle",
          ) ||
          resizeParamsRef.current
        ) {
          return;
        }
        setShowHandles(false);
      }}>
      <div className="p-4 border rounded-lg h-full">
        <DiagramView
          diagramId={diagramId as Id<"diagrams">}
          onAspectRatioChange={setAspectRatio}
        />
      </div>
      {showHandles && (
        <>
          <div
            className="bn-resize-handle"
            style={{
              ...resizeHandleStyle,
              top: "50%",
              left: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => resizeHandleMouseDownHandler(e, "l")}
          />
          <div
            className="bn-resize-handle"
            style={{
              ...resizeHandleStyle,
              top: "50%",
              right: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => resizeHandleMouseDownHandler(e, "r")}
          />
        </>
      )}
    </div>
  );
};

export const DiagramBlock = createReactBlockSpec(
  {
    type: "diagram",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      diagramId: {
        default: null as unknown as Id<"diagrams">,
      },
      width: {
        default: 512,
      },
    },
    content: "none",
  },
  {
    render: (props: any) => {
      return <ResizableDiagram {...props} />;
    },
  },
); 