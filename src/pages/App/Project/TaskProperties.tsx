import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
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
import { ESTIMATE_PRESETS, formatEstimate, isOverdue } from "@/lib/task-utils";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarIcon,
  Clock,
  Minus,
  X,
} from "lucide-react";
import { useState } from "react";
import { Id } from "../../../../convex/_generated/dataModel";

function getPriorityIcon(priority: string) {
  switch (priority) {
    case "urgent":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "high":
      return <ArrowUp className="w-4 h-4 text-orange-500" />;
    case "medium":
      return <Minus className="w-4 h-4 text-yellow-500" />;
    case "low":
      return <ArrowDown className="w-4 h-4 text-gray-400" />;
    default:
      return <Minus className="w-4 h-4 text-gray-400" />;
  }
}

function getPriorityLabel(priority: string) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/** Convert Date to ISO date string (YYYY-MM-DD) in local timezone */
function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse ISO date string to Date in local timezone */
function parseISODate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

type TaskPropertiesProps = {
  task: {
    statusId: Id<"taskStatuses">;
    status: { name: string; color: string } | null;
    priority: string;
    assigneeId?: Id<"users"> | null;
    assignee: { name?: string | null; image?: string } | null;
    labels?: string[];
    dueDate?: string;
    startDate?: string;
    estimate?: number;
  };
  statuses: Array<{ _id: Id<"taskStatuses">; name: string; color: string }>;
  members: Array<{ userId: Id<"users">; name?: string | null; image?: string }>;
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: "urgent" | "high" | "medium" | "low") => void;
  onAssigneeChange: (value: string) => void;
  onAddLabel: (label: string) => void;
  onRemoveLabel: (label: string) => void;
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
  onAddLabel,
  onRemoveLabel,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
}: TaskPropertiesProps) {
  const [newLabel, setNewLabel] = useState("");

  const handleAddLabel = () => {
    if (newLabel.trim()) {
      onAddLabel(newLabel.trim());
      setNewLabel("");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        Properties
      </h3>

      {/* Status */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Status</Label>
        <div className="col-span-2">
          <Select value={task.statusId} onValueChange={onStatusChange}>
            <SelectTrigger>
              <SelectValue>
                {task.status && (
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        task.status.color
                      )}
                    />
                    <span>{task.status.name}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status._id} value={status._id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        status.color
                      )}
                    />
                    <span>{status.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Priority */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Priority</Label>
        <div className="col-span-2">
          <Select value={task.priority} onValueChange={onPriorityChange}>
            <SelectTrigger>
              <SelectValue>
                <div className="flex items-center gap-2">
                  {getPriorityIcon(task.priority)}
                  <span>{getPriorityLabel(task.priority)}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["urgent", "high", "medium", "low"] as const).map(
                (priority) => (
                  <SelectItem key={priority} value={priority}>
                    <div className="flex items-center gap-2">
                      {getPriorityIcon(priority)}
                      <span>{getPriorityLabel(priority)}</span>
                    </div>
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Assignee */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Assignee</Label>
        <div className="col-span-2">
          <Select
            value={task.assigneeId || "unassigned"}
            onValueChange={onAssigneeChange}
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
                        {task.assignee.name
                          ?.slice(0, 2)
                          .toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span>{task.assignee.name}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    Unassigned
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">
                <span className="text-muted-foreground">
                  Unassigned
                </span>
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
        </div>
      </div>

      {/* Due Date */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Due Date</Label>
        <div className="col-span-2 flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !task.dueDate && "text-muted-foreground",
                  task.dueDate && isOverdue(task.dueDate) && "text-red-500 border-red-500/50"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {task.dueDate
                  ? parseISODate(task.dueDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "No due date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={task.dueDate ? parseISODate(task.dueDate) : undefined}
                onSelect={(date) =>
                  onDueDateChange(date ? toISODateString(date) : null)
                }
                autoFocus
              />
            </PopoverContent>
          </Popover>
          {task.dueDate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onDueDateChange(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Start Date */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Start Date</Label>
        <div className="col-span-2 flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !task.startDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {task.startDate
                  ? parseISODate(task.startDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "No start date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={task.startDate ? parseISODate(task.startDate) : undefined}
                onSelect={(date) =>
                  onStartDateChange(date ? toISODateString(date) : null)
                }
                autoFocus
              />
            </PopoverContent>
          </Popover>
          {task.startDate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onStartDateChange(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Estimate */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm">Estimate</Label>
        <div className="col-span-2 flex items-center gap-2">
          <Select
            value={task.estimate != null ? String(task.estimate) : "none"}
            onValueChange={(val) =>
              onEstimateChange(val === "none" ? null : Number(val))
            }
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
        </div>
      </div>

      {/* Labels */}
      <div className="grid grid-cols-3 gap-4 items-start">
        <Label className="text-sm pt-2">Labels</Label>
        <div className="col-span-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {task.labels?.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="flex items-center gap-1"
              >
                {label}
                <button
                  onClick={() => onRemoveLabel(label)}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddLabel();
                }
              }}
              placeholder="Add label..."
              className="h-8 text-sm"
            />
            <Button
              onClick={handleAddLabel}
              size="sm"
              variant="secondary"
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
