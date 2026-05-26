import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { m } from "framer-motion";
import { KanbanCardPresenter } from "./KanbanCardPresenter";
import { useRegisterCardNode } from "./kanbanFly";

type KanbanCardProps = {
  task: {
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
    pullRequestState?: "draft" | "open" | "merged" | "closed";
    externalRefs?: Array<{ deleted?: boolean }>;
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
  /** True while a board-level "flying card" ghost animates this task from its
   *  old column to here. The real card stays mounted (so it reserves its slot)
   *  but renders invisibly until the ghost lands. */
  isHidden?: boolean;
};

export function KanbanCard({ task, onClick, layoutEnabled, isHidden }: KanbanCardProps) {
  const registerCardNode = useRegisterCardNode();
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
      // Register the slot's DOM node so the board can measure it for the
      // cross-column flying-card animation.
      ref={(el) => registerCardNode(task._id, el)}
      // "position" animates the card's translation only — never its size — so
      // the whole card slides to its new slot instead of motion scaling the box
      // (which distorts the border and makes the content appear to drift).
      layout={layoutEnabled ? "position" : false}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // No exit fade: a card that moves columns must vanish from its old column
      // instantly, otherwise it ghost-trails alongside the flying overlay.
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      // Reserve the slot but stay invisible while the flying ghost is in transit.
      style={isHidden ? { visibility: "hidden" } : undefined}
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
