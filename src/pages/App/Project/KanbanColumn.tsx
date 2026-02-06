import { Badge } from "@/components/ui/badge";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { KanbanCard } from "./KanbanCard";

type KanbanColumnProps = {
  status: {
    _id: string;
    name: string;
    color: string;
    order: number;
  };
  tasks: Array<{
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
    } | null;
  }>;
  onTaskClick: (taskId: string) => void;
};

export function KanbanColumn({ status, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id: status._id,
  });

  return (
    <div className="flex flex-col w-72 bg-muted/30 rounded-lg p-2 flex-shrink-0">
      {/* Column Header */}
      <div className="flex items-center gap-2 px-2 py-3 mb-2">
        <span className={cn("w-2 h-2 rounded-full", status.color)} />
        <h3 className="font-semibold text-sm flex-1">{status.name}</h3>
        <Badge variant="secondary" className="text-xs">
          {tasks.length}
        </Badge>
      </div>

      {/* Task List */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        <SortableContext
          items={tasks.map((t) => t._id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center p-4 border-2 border-dashed rounded-lg text-muted-foreground text-sm">
              Drop tasks here
            </div>
          ) : (
            tasks.map((task) => (
              <KanbanCard
                key={task._id}
                task={task}
                onClick={() => onTaskClick(task._id)}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
