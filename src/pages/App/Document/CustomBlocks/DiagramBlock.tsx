import { useDiagramPreview } from "@/hooks/use-diagram-preview";
import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec, ReactCustomBlockRenderProps } from "@blocknote/react";
import { CircleSlash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "../../../../components/ui/skeleton";

const DiagramView = ({
  diagramId,
}: {
  diagramId: Id<"diagrams">;
  onAspectRatioChange?: (ratio: number) => void;
}) => {
  const { svgHtml, isLoading, refresh, diagram } =
    useDiagramPreview(diagramId);
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const handleClick = () => {
    if (diagram && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (diagram === null) {
    return (
      <div className="w-full flex flex-col items-center justify-center p-4 border rounded-lg text-center text-muted-foreground bg-secondary h-40 gap-2">
        <CircleSlash className="h-10 w-10 text-destructive" />
        <p className="text-destructive">
          Diagram not found. It may have been deleted.
        </p>
      </div>
    );
  }

  if (svgHtml) {
    return (
      <div className="relative group">
        <div className="w-full flex justify-end">
          <div className="text-sm text-muted-foreground bg-muted text-right -mt-4 -mr-4 px-2 rounded-tr rounded-bl">
            {diagram?.name}
            </div>
        </div>
        <div
          className="w-full cursor-pointer hover:opacity-90 transition-opacity [&>svg]:w-full [&>svg]:h-auto overflow-hidden"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
    );
  }

  // No SVG available — empty diagram or never generated
  return (
    <div
      className="w-full flex flex-col items-center justify-center p-4 text-center text-muted-foreground bg-secondary h-40 gap-2 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={handleClick}
    >
      <p>Click to view or edit this diagram.</p>
      <p className="text-sm text-muted-foreground">Diagrams use live collaboration and cannot be previewed inline.</p>
    </div>
  );
};

const diagramPropSchema = {
  textAlignment: defaultProps.textAlignment,
  diagramId: {
    default: null as unknown as Id<"diagrams">,
  },
  width: {
    default: 512,
  },
} as const;

type DiagramBlockProps = ReactCustomBlockRenderProps<"diagram", typeof diagramPropSchema, "none">;

const ResizableDiagram = ({ block, editor }: DiagramBlockProps) => {
  const { diagramId } = block.props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const resizeParamsRef = useRef<{
    handleUsed: "l" | "r";
    initialWidth: number;
    initialClientX: number;
  } | undefined>(undefined);

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
      <div className="p-4 border rounded-lg text-center text-muted-foreground">
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
    propSchema: diagramPropSchema,
    content: "none",
  },
  {
    render: (props) => {
      return <ResizableDiagram {...props} />;
    },
  },
); 