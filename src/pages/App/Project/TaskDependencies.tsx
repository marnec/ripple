import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTaskId } from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Ban, Link2, Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type TaskDependenciesProps = {
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
};

type DependencyItem = {
  dependencyId: Id<"taskDependencies">;
  task: {
    _id: Id<"tasks">;
    title: string;
    number?: number;
    projectKey?: string;
    completed: boolean;
  };
};

export function TaskDependencies({ taskId, workspaceId }: TaskDependenciesProps) {
  const deps = useQuery(api.taskDependencies.listByTask, { taskId });
  const createDep = useMutation(api.taskDependencies.create);
  const removeDep = useMutation(api.taskDependencies.remove);

  const [addOpen, setAddOpen] = useState(false);

  if (!deps) return null;

  const { blocks, blockedBy, relatesTo } = deps as {
    blocks: DependencyItem[];
    blockedBy: DependencyItem[];
    relatesTo: DependencyItem[];
  };

  const hasDeps = blocks.length > 0 || blockedBy.length > 0 || relatesTo.length > 0;

  const handleRemove = (dependencyId: Id<"taskDependencies">) => {
    void removeDep({ dependencyId });
  };

  const handleAdd = async (selectedTaskId: Id<"tasks">, uiType: "blocks" | "is_blocked_by" | "relates_to") => {
    if (uiType === "is_blocked_by") {
      // "this task is blocked by selected" → selectedTask blocks thisTask
      // Storage: {taskId: selected, dependsOnTaskId: this, type: "blocks"}
      await createDep({ taskId: selectedTaskId, dependsOnTaskId: taskId, type: "blocks" });
    } else if (uiType === "blocks") {
      // "this task blocks selected"
      // Storage: {taskId: this, dependsOnTaskId: selected, type: "blocks"}
      await createDep({ taskId, dependsOnTaskId: selectedTaskId, type: "blocks" });
    } else {
      // relates_to — direction doesn't matter semantically
      await createDep({ taskId, dependsOnTaskId: selectedTaskId, type: "relates_to" });
    }
    setAddOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Dependencies
        </h3>
        <AddDependencyPopover
          open={addOpen}
          onOpenChange={setAddOpen}
          workspaceId={workspaceId}
          existingTaskIds={new Set([
            taskId,
            ...blocks.map((d) => d.task._id),
            ...blockedBy.map((d) => d.task._id),
            ...relatesTo.map((d) => d.task._id),
          ])}
          onAdd={handleAdd}
        />
      </div>

      {!hasDeps && (
        <p className="text-xs text-muted-foreground">No dependencies</p>
      )}

      {blockedBy.length > 0 && (
        <DependencyGroup
          label="Blocked by"
          icon={<Ban className="h-3 w-3 text-red-500" />}
          items={blockedBy}
          onRemove={handleRemove}
        />
      )}

      {blocks.length > 0 && (
        <DependencyGroup
          label="Blocks"
          icon={<Ban className="h-3 w-3 text-orange-500" />}
          items={blocks}
          onRemove={handleRemove}
        />
      )}

      {relatesTo.length > 0 && (
        <DependencyGroup
          label="Related to"
          icon={<Link2 className="h-3 w-3 text-muted-foreground" />}
          items={relatesTo}
          onRemove={handleRemove}
        />
      )}
    </div>
  );
}

function DependencyGroup({
  label,
  icon,
  items,
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  items: DependencyItem[];
  onRemove: (id: Id<"taskDependencies">) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {items.map((item) => {
        const taskIdStr = formatTaskId(item.task.projectKey, item.task.number);
        return (
          <div
            key={item.dependencyId}
            className="flex items-center gap-2 pl-5 group"
          >
            {taskIdStr && (
              <Badge variant="outline" className="font-mono text-xs px-1.5 py-0">
                {taskIdStr}
              </Badge>
            )}
            <span
              className={cn(
                "text-sm truncate flex-1",
                item.task.completed && "line-through text-muted-foreground"
              )}
            >
              {item.task.title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onRemove(item.dependencyId)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function AddDependencyPopover({
  open,
  onOpenChange,
  workspaceId,
  existingTaskIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
  existingTaskIds: Set<string>;
  onAdd: (selectedTaskId: Id<"tasks">, type: "blocks" | "is_blocked_by" | "relates_to") => Promise<void>;
}) {
  const [depType, setDepType] = useState<"blocks" | "is_blocked_by" | "relates_to">("blocks");
  const allTasks = useQuery(api.tasks.listByWorkspace, open ? { workspaceId, hideCompleted: false } : "skip");

  const availableTasks = (allTasks ?? []).filter(
    (t: any) => !existingTaskIds.has(t._id)
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b">
          <Select value={depType} onValueChange={(v: any) => setDepType(v)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blocks">Blocks</SelectItem>
              <SelectItem value="is_blocked_by">Is blocked by</SelectItem>
              <SelectItem value="relates_to">Related to</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Command>
          <CommandInput placeholder="Search tasks..." />
          <CommandList>
            <CommandEmpty>No tasks found</CommandEmpty>
            {availableTasks.map((t: any) => {
              const tid = formatTaskId(t.projectKey, t.number);
              return (
                <CommandItem
                  key={t._id}
                  value={`${tid ?? ""} ${t.title}`}
                  onSelect={() => void onAdd(t._id as Id<"tasks">, depType)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {tid && (
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        {tid}
                      </span>
                    )}
                    <span className="truncate">{t.title}</span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
