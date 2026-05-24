import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { m } from "framer-motion";
import { KanbanCardPresenter } from "./KanbanCardPresenter";

type KanbanCardProps = {
  task: {
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
    pullRequestState?: "draft" | "open" | "merged" | "closed";
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
      image?: string;
    } | null;
  };
  onClick: () => void;
  /** When false (during a drag/drop settle), motion layout animation is
   *  disabled so it doesn't fight dnd-kit's transforms. */
  layoutEnabled: boolean;
};

export function KanbanCard({ task, onClick, layoutEnabled }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  // dnd-kit owns the inner element's transform during a drag. Motion owns the
  // outer wrapper's position/enter/exit. The two never act at once: while
  // dragging, layout animation is disabled (layoutEnabled=false) and the
  // wrapper doesn't reflow; on settle, dnd-kit's transform clears and motion
  // animates the reorder. Because these are nested, the inner box equals the
  // outer box, so dnd-kit's measurements stay correct.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <m.div
      // "position" animates the card's translation only — never its size — so
      // the whole card slides to its new slot instead of motion scaling the box
      // (which distorts the border and makes the content appear to drift).
      layout={layoutEnabled ? "position" : false}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="outline-none"
      >
        {isDragging ? (
          // Placeholder while dragging — render invisibly to preserve height.
          <div className="relative overflow-hidden rounded-lg bg-muted/50 outline-dashed outline-2 outline-border -outline-offset-2">
            <div className="invisible">
              <KanbanCardPresenter task={task} onClick={() => {}} />
            </div>
          </div>
        ) : (
          <KanbanCardPresenter task={task} onClick={onClick} />
        )}
      </div>
    </m.div>
  );
}
