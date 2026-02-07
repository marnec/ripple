import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
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

type TaskPropertiesProps = {
  task: {
    statusId: Id<"taskStatuses">;
    status: { name: string; color: string } | null;
    priority: string;
    assigneeId?: Id<"users"> | null;
    assignee: { name?: string | null; image?: string } | null;
    labels?: string[];
  };
  statuses: Array<{ _id: Id<"taskStatuses">; name: string; color: string }>;
  members: Array<{ userId: Id<"users">; name?: string | null; image?: string }>;
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: "urgent" | "high" | "medium" | "low") => void;
  onAssigneeChange: (value: string) => void;
  onAddLabel: (label: string) => void;
  onRemoveLabel: (label: string) => void;
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
