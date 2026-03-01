import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Clock, X } from "lucide-react";
import { useState } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import { DatePickerField } from "./DatePickerField";
import { PropertyRow } from "./PropertyRow";

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
    <div className="space-y-2.5">
      {/* Status */}
      <PropertyRow label="Status">
        <Select value={task.statusId} onValueChange={onStatusChange}>
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

      {/* Start Date */}
      <PropertyRow label="Start Date">
        <DatePickerField
          value={task.startDate}
          onChange={onStartDateChange}
          placeholder="No start date"
        />
      </PropertyRow>

      {/* Estimate */}
      <PropertyRow label="Estimate">
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
      </PropertyRow>

      {/* Labels */}
      <PropertyRow label="Labels" alignTop>
        <div className="space-y-2">
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
      </PropertyRow>
    </div>
  );
}
