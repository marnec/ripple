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
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex-helpers/react/cache";
import {
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Check,
  Filter,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type { TaskPriority } from "@/lib/task-utils";
export type SortField = "created" | "dueDate" | "startDate";
export type SortDirection = "asc" | "desc";

// Binary view toggle. The legacy "all" mode mixed bounded (active) and
// unbounded (completed) sets, which forced in-memory filtering on the
// completed half — incompatible with the indexed-only completed contract.
export type CompletionFilter = "completed" | "uncompleted";

// In completed mode the toolbar enforces:
//  - At most ONE of {assigneeIds, priorities, tags} is non-empty (mutex
//    across filter axes).
//  - The non-empty axis has at most ONE element (single-select).
// This keeps every backend query on a single indexed range scan.
// In active mode all three arrays are independently multi-select.
export type TaskFilters = {
  completionFilter: CompletionFilter;
  assigneeIds: string[];
  priorities: TaskPriority[];
  tags: string[];
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
  workspaceId: Id<"workspaces">;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  sort: TaskSort;
  onSortChange: (sort: TaskSort) => void;
  members: Member[];
  sortBlocked?: boolean;
  hideAssigneeFilter?: boolean;
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
  workspaceId,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  members,
  sortBlocked,
  hideAssigneeFilter,
}: TaskToolbarProps) {
  const isMobile = useIsMobile();
  const [completionOpen, setCompletionOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const allTags = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];
  const normalizedTagQuery = tagQuery.trim().toLowerCase();
  const filteredTags = normalizedTagQuery
    ? allTags.filter((t) => t.includes(normalizedTagQuery))
    : allTags;

  const activeFilterCount =
    (filters.completionFilter !== "uncompleted" ? 1 : 0) +
    (filters.assigneeIds.length > 0 ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0) +
    (filters.tags.length > 0 ? 1 : 0);

  const isCompletedView = filters.completionFilter === "completed";

  const toggleAssignee = (id: string) => {
    if (isCompletedView) {
      // Single-select mutex: clear other axes and replace this one with at
      // most one entry. The backend's indexed query path requires it.
      const isAlreadySelected = filters.assigneeIds[0] === id && filters.assigneeIds.length === 1;
      onFiltersChange({
        ...filters,
        assigneeIds: isAlreadySelected ? [] : [id],
        priorities: [],
        tags: [],
      });
      return;
    }
    const next = filters.assigneeIds.includes(id)
      ? filters.assigneeIds.filter((a) => a !== id)
      : [...filters.assigneeIds, id];
    onFiltersChange({ ...filters, assigneeIds: next });
  };

  const togglePriority = (p: TaskPriority) => {
    if (isCompletedView) {
      const isAlreadySelected = filters.priorities[0] === p && filters.priorities.length === 1;
      onFiltersChange({
        ...filters,
        priorities: isAlreadySelected ? [] : [p],
        assigneeIds: [],
        tags: [],
      });
      return;
    }
    const next = filters.priorities.includes(p)
      ? filters.priorities.filter((x) => x !== p)
      : [...filters.priorities, p];
    onFiltersChange({ ...filters, priorities: next });
  };

  const toggleTag = (tag: string) => {
    if (isCompletedView) {
      const isAlreadySelected = filters.tags[0] === tag && filters.tags.length === 1;
      onFiltersChange({
        ...filters,
        tags: isAlreadySelected ? [] : [tag],
        assigneeIds: [],
        priorities: [],
      });
      return;
    }
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    onFiltersChange({ ...filters, tags: next });
  };

  const clearFilters = () => {
    onFiltersChange({
      ...filters,
      completionFilter: "uncompleted",
      assigneeIds: [],
      priorities: [],
      tags: [],
    });
  };

  const completionLabels: Record<CompletionFilter, string> = {
    uncompleted: "Active",
    completed: "Completed",
  };
  const completionActive = filters.completionFilter !== "uncompleted";

  const switchCompletionMode = (next: CompletionFilter) => {
    if (next === filters.completionFilter) return;
    // Switching modes clears filter axes — the multi-select state from
    // active mode wouldn't be valid under the completed-mode mutex, and the
    // single-select state from completed mode is rarely what a user wants
    // to inherit when going back to active.
    onFiltersChange({
      ...filters,
      completionFilter: next,
      assigneeIds: [],
      priorities: [],
      tags: [],
    });
    setCompletionOpen(false);
  };

  return (
    <div className={cn("flex items-center gap-2", isMobile ? "flex-col items-stretch" : "flex-wrap")}>
      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
      <Filter className={cn("w-3.5 h-3.5 shrink-0", activeFilterCount > 0 ? "text-primary" : "text-muted-foreground")} />
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
          {completionLabels[filters.completionFilter]}
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2" align="start">
          <div className="flex flex-col gap-0.5">
            {(["uncompleted", "completed"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => switchCompletionMode(opt)}
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
      {!hideAssigneeFilter && <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
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
      </Popover>}

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

      {/* Tag filter */}
      <Popover open={tagOpen} onOpenChange={setTagOpen}>
        <PopoverTrigger
          render={<button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs font-medium transition-colors cursor-pointer",
              filters.tags.length > 0
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          />}
        >
            <TagIcon className="w-3 h-3" />
            Tags
            {filters.tags.length > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.tags.length}
              </span>
            )}
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          {allTags.length > 0 && (
            <input
              type="text"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="Search tags..."
              className="w-full mb-1 px-2 py-1 text-xs rounded-md border border-input bg-transparent outline-none focus:border-primary/50"
            />
          )}
          <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {filteredTags.map((tag) => {
              const selected = filters.tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <span className="truncate flex-1 text-left">{tag}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
            {filteredTags.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">
                {allTags.length === 0 ? "No tags in this workspace" : "No matches"}
              </p>
            )}
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
      </div>

      {/* Sort */}
      <div
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-md pr-1.5 transition-colors h-7",
          sort && "bg-primary/10"
        )}
      >
        {sortBlocked && (
          <span className="absolute -top-1 -right-1 flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
        )}
        <ArrowUpDown className={cn("w-3.5 h-3.5 shrink-0", sort ? "text-primary" : "text-muted-foreground")} />
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
