import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KanbanCardPresenter } from "./KanbanCardPresenter";

type KanbanCardProps = {
  task: {
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
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
};

export function KanbanCard({ task, onClick }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Show placeholder when dragging — render card invisibly to preserve exact height
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="relative border-2 border-dashed rounded-lg bg-muted/50"
      >
        <div className="invisible">
          <KanbanCardPresenter task={task} onClick={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-task-id={task._id}
      {...attributes}
      {...listeners}
    >
      <KanbanCardPresenter task={task} onClick={onClick} />
    </div>
  );
}
