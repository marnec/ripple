import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { cn } from "@/lib/utils";
import {
  PRIORITIES,
  getPriorityIcon,
  type TaskPriority,
} from "@/lib/task-utils";
import {
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Check,
  Filter,
  X,
} from "lucide-react";
import { useState } from "react";

export type { TaskPriority } from "@/lib/task-utils";
export type SortField = "created" | "dueDate" | "startDate";
export type SortDirection = "asc" | "desc";

export type CompletionFilter = "all" | "completed" | "uncompleted";

export type TaskFilters = {
  completionFilter: CompletionFilter;
  assigneeIds: string[];
  priorities: TaskPriority[];
};

export type TaskSort = {
  field: SortField;
  direction: SortDirection;
} | null;

type Member = {
  _id: string;
  name?: string;
  image?: string;
};

type TaskToolbarProps = {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  sort: TaskSort;
  onSortChange: (sort: TaskSort) => void;
  members: Member[];
  sortBlocked?: boolean;
};

const priorities = PRIORITIES.map((p) => ({
  ...p,
  icon: getPriorityIcon(p.value, "w-3.5 h-3.5"),
}));

const sortOptions: { value: SortField; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "dueDate", label: "Due date" },
  { value: "startDate", label: "Start date" },
];

export function TaskToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  members,
  sortBlocked,
}: TaskToolbarProps) {
  const [completionOpen, setCompletionOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  const activeFilterCount =
    (filters.completionFilter !== "uncompleted" ? 1 : 0) +
    (filters.assigneeIds.length > 0 ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0);

  const toggleAssignee = (id: string) => {
    const next = filters.assigneeIds.includes(id)
      ? filters.assigneeIds.filter((a) => a !== id)
      : [...filters.assigneeIds, id];
    onFiltersChange({ ...filters, assigneeIds: next });
  };

  const togglePriority = (p: TaskPriority) => {
    const next = filters.priorities.includes(p)
      ? filters.priorities.filter((x) => x !== p)
      : [...filters.priorities, p];
    onFiltersChange({ ...filters, priorities: next });
  };

  const clearFilters = () => {
    onFiltersChange({ ...filters, completionFilter: "uncompleted", assigneeIds: [], priorities: [] });
  };

  const completionLabels: Record<string, string> = { all: "All", completed: "Completed", uncompleted: "Uncompleted" };
  const completionActive = filters.completionFilter !== "uncompleted";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Completion filter */}
      <Popover open={completionOpen} onOpenChange={setCompletionOpen}>
        <PopoverTrigger
          render={<button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs font-medium transition-colors cursor-pointer",
              completionActive
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          />}
        >
          <Filter className="w-3 h-3" />
          {completionLabels[filters.completionFilter]}
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2" align="start">
          <div className="flex flex-col gap-0.5">
            {(["uncompleted", "all", "completed"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => { onFiltersChange({ ...filters, completionFilter: opt }); setCompletionOpen(false); }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                  filters.completionFilter === opt ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <span className="flex-1 text-left">{completionLabels[opt]}</span>
                {filters.completionFilter === opt && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Assignee filter */}
      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger
          render={<button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs font-medium transition-colors cursor-pointer",
              filters.assigneeIds.length > 0
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          />}
        >
            <Filter className="w-3 h-3" />
            Assignee
            {filters.assigneeIds.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.assigneeIds.length}
              </span>
            )}
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="start">
          <div className="flex flex-col gap-0.5">
            {members.map((m) => {
              const selected = filters.assigneeIds.includes(m._id);
              return (
                <button
                  key={m._id}
                  onClick={() => toggleAssignee(m._id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <Avatar className="h-5 w-5">
                    {m.image && <AvatarImage src={m.image} alt={m.name ?? ""} />}
                    <AvatarFallback className="text-[10px]">
                      {m.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate flex-1 text-left">{m.name ?? "Unknown"}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
            {members.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">No members</p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Priority filter */}
      <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
        <PopoverTrigger
          render={<button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs font-medium transition-colors cursor-pointer",
              filters.priorities.length > 0
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          />}
        >
            <Filter className="w-3 h-3" />
            Priority
            {filters.priorities.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.priorities.length}
              </span>
            )}
        </PopoverTrigger>
        <PopoverContent className="w-44 p-2" align="start">
          <div className="flex flex-col gap-0.5">
            {priorities.map((p) => {
              const selected = filters.priorities.includes(p.value);
              return (
                <button
                  key={p.value}
                  onClick={() => togglePriority(p.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  {p.icon}
                  <span className="flex-1 text-left">{p.label}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear filters */}
      {activeFilterCount > 0 && (
        <button
          onClick={clearFilters}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}

      {/* Sort */}
      <div
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-md px-1.5 transition-colors h-7",
          sort && "bg-primary/10"
        )}
      >
        {sortBlocked && (
          <span className="absolute -top-1 -right-1 flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
        )}
        <ArrowUpDown className={cn("w-3 h-3", sort ? "text-primary" : "text-muted-foreground")} />
        <Select
          value={sort?.field ?? ""}
          onValueChange={(value) => {
            if (!value) {
              onSortChange(null);
            } else {
              onSortChange({ field: value as SortField, direction: sort?.direction ?? "desc" });
            }
          }}
        >
          <SelectTrigger
            className={cn(
              "h-7! w-27.5 text-xs [&>svg]:h-3 [&>svg]:w-3",
              sort ? "border-none text-primary bg-transparent" : "border-input"
            )}
          >
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sort && (
          <>
            <button
              onClick={() =>
                onSortChange({
                  ...sort,
                  direction: sort.direction === "asc" ? "desc" : "asc",
                })
              }
              className="inline-flex items-center justify-center rounded-md h-7 w-7 text-xs transition-colors cursor-pointer text-primary hover:bg-primary/20"
              title={sort.direction === "asc" ? "Ascending" : "Descending"}
            >
              {sort.direction === "asc" ? (
                <ArrowUp className="w-3 h-3" />
              ) : (
                <ArrowDown className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={() => onSortChange(null)}
              className={cn(
                "inline-flex items-center gap-1 text-xs transition-colors cursor-pointer",
                "text-primary hover:bg-primary/20 rounded-md h-7 w-7",
              )}
            >
              <X className="w-3 h-3 mx-auto" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
