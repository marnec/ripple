import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { TagPickerButton } from "@/components/TagPickerButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ESTIMATE_PRESETS,
  formatEstimate,
  getPriorityIcon,
  getPriorityLabel,
  isOverdue,
} from "@/lib/task-utils";
import { computeHofstadterLabels } from "@/lib/calendar-utils";
import { useQuery } from "convex-helpers/react/cache";
import { Clock, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DatePickerField } from "./DatePickerField";
import { PropertyRow } from "./PropertyRow";

type TaskPropertiesProps = {
  task: {
    workspaceId: Id<"workspaces">;
    statusId: Id<"taskStatuses">;
    status: { name: string; color: string } | null;
    priority: string;
    assigneeId?: Id<"users"> | null;
    assignee: { name?: string | null; image?: string } | null;
    labels?: string[];
    dueDate?: string;
    plannedStartDate?: string;
    estimate?: number;
  };
  statuses: Array<{ _id: Id<"taskStatuses">; name: string; color: string }>;
  members: Array<{ userId: Id<"users">; name?: string | null; image?: string }>;
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: "urgent" | "high" | "medium" | "low") => void;
  onAssigneeChange: (value: string) => void;
  onSetTags: (tags: string[]) => void;
  onRemoveTag: (tag: string) => void;
  onDueDateChange: (date: string | null) => void;
  onStartDateChange: (date: string | null) => void;
  onEstimateChange: (value: number | null) => void;
};

export function TaskProperties({
  task,
  statuses,
  members,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onSetTags,
  onRemoveTag,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
}: TaskPropertiesProps) {
  const [newTag, setNewTag] = useState("");
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [highlight, setHighlight] = useState<string>("");

  const allWorkspaceTags = useQuery(api.tags.listWorkspaceTags, {
    workspaceId: task.workspaceId,
  }) ?? [];

  const normalizedQuery = newTag.trim().toLowerCase();
  const appliedSet = new Set(task.labels ?? []);
  const suggestions = normalizedQuery
    ? allWorkspaceTags
        .filter((t) => t.includes(normalizedQuery) && !appliedSet.has(t))
        .slice(0, 6)
    : [];
  const showSuggestions = autocompleteOpen && suggestions.length > 0;

  // Keep the highlighted suggestion valid as the query changes.
  // Tracking the query in state lets us update derived `highlight` at
  // render time — avoiding a useEffect for derived state.
  const [prevQuery, setPrevQuery] = useState(normalizedQuery);
  if (prevQuery !== normalizedQuery) {
    setPrevQuery(normalizedQuery);
    if (suggestions.length === 0) {
      if (highlight !== "") setHighlight("");
    } else if (!suggestions.includes(highlight)) {
      setHighlight(suggestions[0]);
    }
  }

  const pickSuggestion = (tag: string) => {
    const current = task.labels ?? [];
    if (!current.includes(tag)) onSetTags([...current, tag]);
    setNewTag("");
    setAutocompleteOpen(false);
  };

  const handleAddFromInput = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    const current = task.labels ?? [];
    if (!current.includes(trimmed)) {
      onSetTags([...current, trimmed]);
    }
    setNewTag("");
    setAutocompleteOpen(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setAutocompleteOpen(true);
      const idx = suggestions.indexOf(highlight);
      const next = suggestions[(idx + 1) % suggestions.length];
      setHighlight(next);
    } else if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setAutocompleteOpen(true);
      const idx = suggestions.indexOf(highlight);
      const next = suggestions[(idx - 1 + suggestions.length) % suggestions.length];
      setHighlight(next);
    } else if (e.key === "Escape") {
      setAutocompleteOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && highlight) {
        pickSuggestion(highlight);
      } else {
        handleAddFromInput();
      }
    }
  };

  return (
    <div className="space-y-1.5 md:space-y-2.5">
      {/* Status */}
      <PropertyRow label="Status">
        <Select value={task.statusId} onValueChange={(v) => { if (v !== null) onStatusChange(v); }}>
          <SelectTrigger>
            <SelectValue>
              {task.status && (
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", task.status.color)} />
                  <span>{task.status.name}</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statuses.map((status) => (
              <SelectItem key={status._id} value={status._id}>
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", status.color)} />
                  <span>{status.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      {/* Priority */}
      <PropertyRow label="Priority">
        <Select value={task.priority} onValueChange={(v) => { if (v !== null) onPriorityChange(v as "urgent" | "high" | "medium" | "low"); }}>
          <SelectTrigger>
            <SelectValue>
              <div className="flex items-center gap-2">
                {getPriorityIcon(task.priority)}
                <span>{getPriorityLabel(task.priority)}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["urgent", "high", "medium", "low"] as const).map((priority) => (
              <SelectItem key={priority} value={priority}>
                <div className="flex items-center gap-2">
                  {getPriorityIcon(priority)}
                  <span>{getPriorityLabel(priority)}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      {/* Assignee */}
      <PropertyRow label="Assignee">
        <Select
          value={task.assigneeId || "unassigned"}
          onValueChange={(v) => { if (v !== null) onAssigneeChange(v); }}
        >
          <SelectTrigger>
            <SelectValue>
              {task.assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {task.assignee.image && (
                      <AvatarImage
                        src={task.assignee.image}
                        alt={task.assignee.name ?? "Assignee"}
                      />
                    )}
                    <AvatarFallback className="text-xs">
                      {task.assignee.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span>{task.assignee.name}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">
              <span className="text-muted-foreground">Unassigned</span>
            </SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {member.image && (
                      <AvatarImage
                        src={member.image}
                        alt={member.name ?? "Member"}
                      />
                    )}
                    <AvatarFallback className="text-xs">
                      {member.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span>{member.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      {/* Due Date */}
      <PropertyRow label="Due Date">
        <DatePickerField
          value={task.dueDate}
          onChange={onDueDateChange}
          placeholder="No due date"
          overdue={task.dueDate ? isOverdue(task.dueDate) : false}
        />
      </PropertyRow>

      {/* Planned Start */}
      <PropertyRow label="Planned Start">
        <DatePickerField
          value={task.plannedStartDate}
          onChange={onStartDateChange}
          placeholder="No planned start"
        />
      </PropertyRow>

      {/* Estimate */}
      <PropertyRow label="Estimate">
        <div className="space-y-1">
          <Select
            value={task.estimate != null ? String(task.estimate) : "none"}
            onValueChange={(val) => {
              if (val !== null) onEstimateChange(val === "none" ? null : Number(val));
            }}
          >
            <SelectTrigger>
              <SelectValue>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {task.estimate != null
                      ? formatEstimate(task.estimate)
                      : "No estimate"}
                  </span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">No estimate</span>
              </SelectItem>
              {ESTIMATE_PRESETS.map((hours) => (
                <SelectItem key={hours} value={String(hours)}>
                  {formatEstimate(hours)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {task.estimate != null && (() => {
            const { plan, commit } = computeHofstadterLabels(task.estimate);
            return (
              <div className="flex gap-3 px-1 text-xs text-muted-foreground">
                <span>{plan}</span>
                <span>{commit}</span>
              </div>
            );
          })()}
        </div>
      </PropertyRow>

      {/* Tags */}
      <PropertyRow label="Tags" alignTop>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <TagPickerButton
              workspaceId={task.workspaceId}
              value={task.labels ?? []}
              onChange={onSetTags}
              triggerVariant="pill"
            />
            {task.labels?.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="flex items-center gap-1"
              >
                #{tag}
                <button
                  onClick={() => onRemoveTag(tag)}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={newTag}
                onChange={(e) => {
                  setNewTag(e.target.value);
                  setAutocompleteOpen(true);
                }}
                onKeyDown={handleInputKeyDown}
                onFocus={() => setAutocompleteOpen(true)}
                onBlur={() => {
                  // Defer so a click on a suggestion still registers.
                  setTimeout(() => setAutocompleteOpen(false), 100);
                }}
                placeholder="Add tag…"
                className="h-8 text-sm"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls="tag-autocomplete-list"
              />
              {showSuggestions && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg bg-popover shadow-md ring-1 ring-foreground/10">
                  <Command
                    shouldFilter={false}
                    value={highlight}
                    onValueChange={setHighlight}
                  >
                    <CommandList id="tag-autocomplete-list" className="max-h-48">
                      {suggestions.map((tag) => (
                        <CommandItem
                          key={tag}
                          value={tag}
                          onSelect={() => pickSuggestion(tag)}
                          // Prevent input blur from firing before the click
                          // registers on this item.
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          #{tag}
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </div>
              )}
            </div>
            <Button
              onClick={handleAddFromInput}
              size="sm"
              variant="secondary"
            >
              Add
            </Button>
          </div>
        </div>
      </PropertyRow>
    </div>
  );
}
