import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle, ArrowDown, ArrowUp, Minus } from "lucide-react";

type KanbanCardPresenterProps = {
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
    } | null;
  };
  onClick: () => void;
  isDragging?: boolean;
};

export function KanbanCardPresenter({
  task,
  onClick,
  isDragging = false,
}: KanbanCardPresenterProps) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all",
        isDragging && "shadow-lg rotate-2"
      )}
    >
      <CardHeader className="py-2 px-3">
        <h3 className="text-sm font-medium truncate">{task.title}</h3>
      </CardHeader>
      <CardContent className="py-2 px-3 pt-0">
        <div className="flex items-center justify-between mb-2">
          {/* Priority Icon */}
          <div className="flex-shrink-0">
            {task.priority === "urgent" && (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
            {task.priority === "high" && (
              <ArrowUp className="w-4 h-4 text-orange-500" />
            )}
            {task.priority === "medium" && (
              <Minus className="w-4 h-4 text-yellow-500" />
            )}
            {task.priority === "low" && (
              <ArrowDown className="w-4 h-4 text-gray-400" />
            )}
          </div>

          {/* Assignee Avatar */}
          {task.assignee && (
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">
                {task.assignee.name?.slice(0, 2).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>

        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.map((label, index) => (
              <Badge key={index} variant="secondary" className="text-xs py-0">
                {label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
