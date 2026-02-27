import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  ArrowUpDown,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Filter,
  Minus,
  X,
} from "lucide-react";
import { useState } from "react";

export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type SortField = "created" | "dueDate" | "startDate";
export type SortDirection = "asc" | "desc";

export type TaskFilters = {
  hideCompleted: boolean;
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
};

const priorities: { value: TaskPriority; label: string; icon: React.ReactNode }[] = [
  { value: "urgent", label: "Urgent", icon: <AlertCircle className="w-3.5 h-3.5 text-red-500" /> },
  { value: "high", label: "High", icon: <ArrowUp className="w-3.5 h-3.5 text-orange-500" /> },
  { value: "medium", label: "Medium", icon: <Minus className="w-3.5 h-3.5 text-yellow-500" /> },
  { value: "low", label: "Low", icon: <ArrowDown className="w-3.5 h-3.5 text-gray-400" /> },
];

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
}: TaskToolbarProps) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  const activeFilterCount =
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
    onFiltersChange({ ...filters, assigneeIds: [], priorities: [] });
  };

  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {/* Hide completed toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="hide-completed"
          checked={filters.hideCompleted}
          onCheckedChange={(checked) =>
            onFiltersChange({ ...filters, hideCompleted: checked === true })
          }
        />
        <Label
          htmlFor="hide-completed"
          className="text-sm font-normal cursor-pointer"
        >
          Hide completed
        </Label>
      </div>

      <div className="w-px h-4 bg-border" />

      {/* Assignee filter */}
      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              filters.assigneeIds.length > 0
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Filter className="w-3 h-3" />
            Assignee
            {filters.assigneeIds.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.assigneeIds.length}
              </span>
            )}
          </button>
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
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              filters.priorities.length > 0
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Filter className="w-3 h-3" />
            Priority
            {filters.priorities.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.priorities.length}
              </span>
            )}
          </button>
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

      <div className="w-px h-4 bg-border" />

      {/* Sort */}
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
          sort && "bg-primary/10 ring-1 ring-primary/30"
        )}
      >
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
              "h-7 w-[110px] text-xs [&>svg]:h-3 [&>svg]:w-3",
              sort ? "border-primary/50 text-primary" : "border-input"
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
              className="inline-flex items-center justify-center rounded-md border border-primary/50 h-7 w-7 text-xs text-primary hover:bg-primary/20 transition-colors cursor-pointer"
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
              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
