import { Badge } from "@ripple/ui/components/badge";
import { Button } from "@ripple/ui/components/button";
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
} from "@ripple/ui/components/select";
import { formatTaskId } from "@/lib/task-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache";;
import { Ban, ChevronRight, Link2, Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { type DependencyType, useTaskDependencies } from "./useTaskDependencies";
import type { Id } from "@convex/_generated/dataModel";

type TaskDependenciesProps = {
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
  /** Render the section as a collapse toggle, collapsed by default (used in the narrow detail sheet). */
  collapsible?: boolean;
};

type DependencyItem = {
  edgeId: Id<"edges">;
  task: {
    _id: Id<"tasks">;
    title: string;
    number?: number;
    projectKey?: string;
    completed: boolean;
  };
};

export function TaskDependencies({ taskId, workspaceId, collapsible = false }: TaskDependenciesProps) {
  const { loaded, blocks, blockedBy, relatesTo, totalCount, existingTaskIds, add, remove } =
    useTaskDependencies(taskId);

  const [addOpen, setAddOpen] = useState(false);
  const [open, setOpen] = useState(false);

  const hasDeps = totalCount > 0;
  // Non-collapsible (full page) always shows its body; the sheet starts collapsed.
  const expanded = !collapsible || open;

  const handleRemove = remove;

  const handleAdd = async (selectedTaskId: Id<"tasks">, uiType: DependencyType) => {
    await add(selectedTaskId, uiType);
    setAddOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex flex-1 items-center gap-1.5 -ml-1 rounded px-1 py-0.5 cursor-pointer hover:bg-muted/50"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <h3 className="text-sm font-semibold text-muted-foreground">
              Dependencies
            </h3>
            {totalCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono tabular-nums">
                {totalCount}
              </Badge>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Dependencies
            </h3>
            {totalCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono tabular-nums">
                {totalCount}
              </Badge>
            )}
          </div>
        )}
        {/* Add button stays mounted with collapsible so opacity/pointer-events
            can fade in/out alongside the body's max-height transition. */}
        <div
          className={cn(
            "transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          <AddDependencyPopover
            open={addOpen}
            onOpenChange={setAddOpen}
            workspaceId={workspaceId}
            existingTaskIds={existingTaskIds}
            onAdd={handleAdd}
          />
        </div>
      </div>

      {/* Body wrapper animates max-height between 0 and the ScrollArea's
          height (7rem == h-28). overflow-hidden clips content during the
          transition. Non-collapsible (full-page) callers always see expanded.
          The fixed-height ScrollArea is only for an actual list: the empty
          state is one line, and boxing it in 7rem left a blank block. */}
      <div
        className="overflow-hidden"
        style={{
          maxHeight: expanded ? "7rem" : 0,
          transition: "max-height 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {loaded && !hasDeps ? (
          <p className="text-xs text-muted-foreground py-1 animate-fade-in">No dependencies</p>
        ) : (
        <ScrollArea className="h-28">
          <div className={cn("space-y-3 pr-3", loaded && "animate-fade-in")}>
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
        </ScrollArea>
        )}
      </div>
    </div>
  );
}

export function DependencyGroup({
  label,
  icon,
  items,
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  items: DependencyItem[];
  onRemove: (id: Id<"edges">) => void;
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
            key={item.edgeId}
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
              className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:h-8 pointer-coarse:w-8 pointer-coarse:opacity-100"
              onClick={() => onRemove(item.edgeId)}
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
  onAdd: (selectedTaskId: Id<"tasks">, type: DependencyType) => Promise<void>;
}) {
  const [depType, setDepType] = useState<DependencyType>("blocks");
  // Server-side search over the workspace's tasks. This used to subscribe to
  // both completion halves of `listByWorkspace` — i.e. every task in the
  // workspace, enriched, just to client-filter it down to a popover list.
  // `includeCompleted` keeps "blocked by the finished migration" reachable.
  const [search, setSearch] = useState("");
  const suggestions = useQuery(
    api.tasks.suggest,
    open ? { workspaceId, query: search, includeCompleted: true, limit: 20 } : "skip",
  );

  const availableTasks = (suggestions ?? []).filter((t) => !existingTaskIds.has(t._id));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-7 px-2" />}>
          <Plus className="h-3 w-3 mr-1" />
          Add
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
        {/* `shouldFilter={false}`: the server already matched the query, and
            cmdk's own fuzzy pass would drop rows the search index kept. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search tasks..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No tasks found</CommandEmpty>
            {availableTasks.map((t) => {
              const tid = formatTaskId(t.projectKey, t.number);
              return (
                <CommandItem
                  key={t._id}
                  value={`${tid ?? ""} ${t.title}`}
                  onSelect={() => void onAdd(t._id, depType)}
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
