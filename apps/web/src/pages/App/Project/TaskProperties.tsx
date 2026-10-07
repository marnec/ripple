import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { cn } from "@/lib/utils";
import { getPriorityIcon, getPriorityLabel } from "@/lib/task-utils";
import type { Id } from "@convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserAvatar } from "@/components/UserAvatar";
import { ExternalAssigneeAvatars, type ExternalAssignee } from "./ExternalAssignees";
import { PROPERTY_TRIGGER_CLASS, PropertyRow } from "./PropertyRow";
import { TaskPropertyPills, TimeChips } from "./TaskPropertyPills";

type TaskPropertiesProps = {
  task: {
    _id: Id<"tasks">;
    projectId: Id<"projects">;
    workspaceId: Id<"workspaces">;
    statusId: Id<"taskStatuses">;
    status: { name: string; color: string } | null;
    priority: string;
    assigneeId?: Id<"users"> | null;
    assignee: { name?: string | null; image?: string } | null;
    externalAssignees?: ExternalAssignee[];
    tags?: string[];
    dueDate?: string;
    plannedStartDate?: string;
    estimate?: number;
  };
  statuses: Array<{ _id: Id<"taskStatuses">; name: string; color: string }>;
  members: Array<{ userId: Id<"users">; name?: string | null; image?: string }>;
  /**
   * - "page": status, priority and assignee as labelled rows, then the time
   *   chips. On a phone, everything as pills instead (`TaskPropertyPills`).
   * - "sheet": status and priority rows, then the time chips. The sheet puts
   *   the assignee beside its title and the tags under it.
   *
   * Neither folds anything away: an unset time chip reads "+ Label", so it is
   * its own "add" control.
   */
  layout: "page" | "sheet";
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: "urgent" | "high" | "medium" | "low") => void;
  onAssigneeChange: (value: string) => void;
  onSetTags: (tags: string[]) => void;
  onDueDateChange: (date: string | null) => void;
  onStartDateChange: (date: string | null) => void;
  onEstimateChange: (value: number | null) => void;
};

export function TaskProperties({
  task,
  statuses,
  members,
  layout,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onSetTags,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
}: TaskPropertiesProps) {
  const isMobile = useIsMobile();

  if (layout === "page" && isMobile) {
    return (
      <TaskPropertyPills
        task={task}
        statuses={statuses}
        members={members}
        onStatusChange={onStatusChange}
        onPriorityChange={onPriorityChange}
        onAssigneeChange={onAssigneeChange}
        onDueDateChange={onDueDateChange}
        onStartDateChange={onStartDateChange}
        onEstimateChange={onEstimateChange}
        onSetTags={onSetTags}
      />
    );
  }

  return (
    <div className="space-y-1">
      <PropertyRow label="Status">
        <Select value={task.statusId} onValueChange={(v) => { if (v !== null) onStatusChange(v); }}>
          <SelectTrigger className={PROPERTY_TRIGGER_CLASS}>
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

      <PropertyRow label="Priority">
        <Select value={task.priority} onValueChange={(v) => { if (v !== null) onPriorityChange(v as "urgent" | "high" | "medium" | "low"); }}>
          <SelectTrigger className={PROPERTY_TRIGGER_CLASS}>
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

      {layout === "page" && (
        <PropertyRow label="Assignee">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Select
                value={task.assigneeId || "unassigned"}
                onValueChange={(v) => { if (v !== null) onAssigneeChange(v); }}
              >
                <SelectTrigger className={PROPERTY_TRIGGER_CLASS}>
                  <SelectValue>
                    {task.assignee ? (
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          className="h-5 w-5"
                          name={task.assignee.name}
                          image={task.assignee.image}
                          alt={task.assignee.name ?? "Assignee"}
                          fallbackClassName="text-xs"
                        />
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
                        <UserAvatar
                          className="h-5 w-5"
                          name={member.name}
                          image={member.image}
                          alt={member.name ?? "Member"}
                          fallbackClassName="text-xs"
                        />
                        <span>{member.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ExternalAssigneeAvatars
              assignees={task.externalAssignees}
              side="right"
              size="sm"
              className="shrink-0"
            />
          </div>
        </PropertyRow>
      )}

      <div className="pt-1">
        <TimeChips
          task={task}
          withDependencies={layout === "sheet"}
          onDueDateChange={onDueDateChange}
          onStartDateChange={onStartDateChange}
          onEstimateChange={onEstimateChange}
        />
      </div>
    </div>
  );
}
