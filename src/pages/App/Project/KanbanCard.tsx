import { cn } from "@/lib/utils";
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
  isExiting?: boolean;
};

export function KanbanCard({ task, onClick, isExiting = false }: KanbanCardProps) {
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

  // Show placeholder when dragging
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="h-24 border-2 border-dashed rounded-lg bg-muted/50"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        isExiting
          ? "animate-out fade-out duration-200 fill-mode-forwards"
          : "animate-in fade-in duration-200"
      )}
      {...attributes}
      {...listeners}
    >
      <KanbanCardPresenter task={task} onClick={onClick} />
    </div>
  );
}
