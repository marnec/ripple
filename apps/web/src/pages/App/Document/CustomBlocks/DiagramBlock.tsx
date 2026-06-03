import { RippleSpinner } from "@/components/RippleSpinner";
import { useDiagramPreview } from "@/hooks/use-diagram-preview";
import { defaultProps, type BlockConfig } from "@blocknote/core";
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { CircleSlash } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";


const DiagramView = ({
  diagramId,
  frameId,
  onAspectRatioChange,
  onNavigate,
}: {
  diagramId: Id<"diagrams">;
  frameId: string | null;
  onAspectRatioChange?: (ratio: number) => void;
  onNavigate: () => void;
}) => {
  const { svgHtml, isLoading, diagram, frameName } =
    useDiagramPreview(diagramId, frameId);

  // width / height from the SVG's viewBox, used to size the container
  // explicitly. The embedded SVG fills its box (height:100%), so the box must
  // carry the aspect ratio itself — otherwise frame SVGs collapse vertically
  // and the embed shows only a clipped sliver.
  const [boxRatio, setBoxRatio] = useState(0);

  const svgContainerRef = (node: HTMLDivElement | null) => {
      if (!node) return;
      const svg = node.querySelector("svg");
      if (!svg) return;
      const { width, height } = svg.viewBox.baseVal;
      if (width > 0 && height > 0) {
        setBoxRatio((prev) => (Math.abs(prev - width / height) > 0.0001 ? width / height : prev));
        onAspectRatioChange?.(height / width);
      }
    };

  if (!isLoading && diagram === null) {
    return (
      <div data-embed-deleted className="w-full flex flex-col items-center justify-center p-3 border rounded-lg text-center text-muted-foreground bg-secondary h-40 gap-2">
        <CircleSlash className="h-10 w-10 text-destructive" />
        <p className="text-destructive">
          Diagram not found. It may have been deleted.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full min-h-40 h-full">
      {svgHtml ? (
        <div className="animate-fade-in">
          <div className="w-full text-xs text-right text-muted-foreground rounded-tr rounded-bl min-h-lh">
            {diagram ? (
              <span
                className="cursor-pointer hover:underline"
                onClick={onNavigate}
                role="button"
                tabIndex={0}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNavigate();
                  }
                }}
              >
                {diagram.name}
                {frameName ? ` › ${frameName}` : ""}
              </span>
            ) : null}
          </div>
          <div
            ref={svgContainerRef}
            className={`w-full overflow-hidden [&>svg]:block [&>svg]:w-full ${
              boxRatio ? "[&>svg]:h-full" : "[&>svg]:h-auto"
            }`}
            style={boxRatio ? { aspectRatio: String(boxRatio) } : undefined}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <RippleSpinner />
        </div>
      )}
    </div>
  );
};

const diagramPropSchema = {
  textAlignment: defaultProps.textAlignment,
  diagramId: {
    default: null as unknown as Id<"diagrams">,
  },
  // Optional Excalidraw frame to embed instead of the whole diagram. Empty
  // string (the default, and the value on pre-existing embeds) = whole diagram.
  // BlockNote prop values must be string/number/boolean, so we use "" rather
  // than null as the "no frame" sentinel.
  frameId: {
    default: "",
  },
  width: {
    default: 512,
  },
  aspectRatio: {
    default: 0,
  },
} as const;

type DiagramBlockProps = ReactCustomBlockRenderProps<
  BlockConfig<"diagram", typeof diagramPropSchema, "none">
>;

const ResizableDiagram = ({ block, editor }: DiagramBlockProps) => {
  const { diagramId, frameId } = block.props;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const [showHandles, setShowHandles] = useState(false);

  const handleNavigate = () => {
    if (diagramId && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`);
    }
  };

  const handleAspectRatioChange = (ratio: number) => {
    if (ratio !== block.props.aspectRatio) {
      editor.updateBlock(block, {
        props: { aspectRatio: ratio },
      });
    }
  };

  const resizeHandleMouseDownHandler = (
    event: React.MouseEvent,
    handle: "l" | "r",
  ) => {
    event.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const initialWidth = wrapper.clientWidth;
    const initialClientX = event.clientX;
    const alignment = block.props.textAlignment;

    const onMouseMove = (e: MouseEvent) => {
      const xDiff = e.clientX - initialClientX;
      const multiplier = alignment === "center" ? 2 : 1;
      const newWidth =
        handle === "r"
          ? initialWidth + xDiff * multiplier
          : initialWidth - xDiff * multiplier;

      const minWidth = 64;
      const editorWidth = (editor.domElement?.firstElementChild as HTMLElement)
        ?.clientWidth;
      const finalWidth = Math.min(
        Math.max(newWidth, minWidth),
        editorWidth || Number.MAX_VALUE,
      );
      wrapper.style.width = `${finalWidth}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      isResizingRef.current = false;

      editor.updateBlock(block, {
        props: { width: wrapper.clientWidth },
      });
    };

    isResizingRef.current = true;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (!diagramId) {
    return (
      <div className="p-3 border rounded-lg text-center text-muted-foreground">
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
      ref={wrapperRef}
      className="relative"
      style={{
        width: block.props.width,
        maxWidth: "100%",
      }}
      onMouseEnter={() => editor.isEditable && setShowHandles(true)}
      onMouseLeave={(event) => {
        const related = event.relatedTarget as HTMLElement | null;
        if (
          related?.classList?.contains("bn-resize-handle") ||
          isResizingRef.current
        ) {
          return;
        }
        setShowHandles(false);
      }}>
      <div className="p-3 border rounded-lg h-full">
        <DiagramView
          diagramId={diagramId as Id<"diagrams">}
          frameId={frameId || null}
          onAspectRatioChange={handleAspectRatioChange}
          onNavigate={handleNavigate}
        />
      </div>
      {!editor.isEditable && (
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={handleNavigate}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleNavigate();
            }
          }}
        />
      )}
      {showHandles && (
        <>
          <div
            className="bn-resize-handle"
            role="separator"
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
            role="separator"
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
    propSchema: diagramPropSchema,
    content: "none",
  },
  {
    render: (props) => {
      return <ResizableDiagram {...props} />;
    },
  },
); 