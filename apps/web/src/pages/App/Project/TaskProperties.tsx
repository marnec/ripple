import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@ripple/ui/components/badge";
import { TagPickerButton } from "@/components/TagPickerButton";
import { ExternalAssigneeAvatars, type ExternalAssignee } from "./ExternalAssignees";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { cn } from "@/lib/utils";
import {
  ESTIMATE_PRESETS,
  formatEstimate,
  getPriorityIcon,
  getPriorityLabel,
  isOverdue,
} from "@/lib/task-utils";
import { computeHofstadterLabels } from "@/lib/calendar-utils";
import { ChevronDown, Clock, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { DatePickerField } from "./DatePickerField";
import { PROPERTY_TRIGGER_CLASS, PropertyRow } from "./PropertyRow";
import { TaskPropertyPills } from "./TaskPropertyPills";
import { useIsMobile } from "@/hooks/use-mobile";

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
   * Fold everything past the essentials (status, priority, assignee, due date)
   * behind a "More details" toggle, folded by default. For a single-column
   * layout where the properties would otherwise push the description below
   * the fold.
   */
  collapsible?: boolean;
  /**
   * Leave tags out: the full page keeps them in its toolbar, as every other
   * resource's `SurfaceHeader` does.
   */
  hideTags?: boolean;
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: "urgent" | "high" | "medium" | "low") => void;
  onAssigneeChange: (value: string) => void;
  onSetTags: (tags: string[]) => void;
  onRemoveTag: (tag: string) => void;
  onDueDateChange: (date: string | null) => void;
  onStartDateChange: (date: string | null) => void;
  onEstimateChange: (value: number | null) => void;
};

/** Properties that take no row until they have a value or the user adds one. */
type OptionalProperty = "plannedStart" | "estimate";

const OPTIONAL_LABELS: Record<OptionalProperty, string> = {
  plannedStart: "Planned start",
  estimate: "Estimate",
};

export function TaskProperties({
  task,
  statuses,
  members,
  collapsible = false,
  hideTags = false,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onSetTags,
  onRemoveTag,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
}: TaskPropertiesProps) {
  const isMobile = useIsMobile();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Optional properties the user asked to add in this view. The caller keys
  // this component by task, so the set never leaks onto another task.
  const [added, setAdded] = useState<ReadonlySet<OptionalProperty>>(new Set());

  const shown: Record<OptionalProperty, boolean> = {
    plannedStart: task.plannedStartDate != null || added.has("plannedStart"),
    estimate: task.estimate != null || added.has("estimate"),
  };
  const addable = (Object.keys(shown) as OptionalProperty[]).filter((p) => !shown[p]);
  // A row the user just added opens its picker straight away; one that
  // already has a value mounts closed.
  const justAdded = (p: OptionalProperty) =>
    added.has(p) && (p === "plannedStart" ? task.plannedStartDate : task.estimate) == null;
  const detailsVisible = !collapsible || detailsOpen;

  const tagsRow = (
    <PropertyRow label="Tags" alignTop>
      <div className="flex flex-wrap items-center gap-1 py-1">
        {task.tags?.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="flex items-center gap-0.5 pr-0.5"
          >
            #{tag}
            <button
              type="button"
              onClick={() => onRemoveTag(tag)}
              aria-label={`Remove tag ${tag}`}
              className="rounded-sm p-0.5 hover:text-destructive pointer-coarse:p-1.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <TagPickerButton
          workspaceId={task.workspaceId}
          value={task.tags ?? []}
          onChange={onSetTags}
          triggerVariant="pill"
        />
      </div>
    </PropertyRow>
  );

  // On a phone every property is a pill (each a bottom sheet), all visible at
  // once: no labelled rows, no "More details" fold. See `TaskPropertyPills`.
  if (isMobile) {
    return (
      <div className="space-y-2">
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
        />
        {!hideTags && tagsRow}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Status */}
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

      {/* Priority */}
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

      {/* Assignee */}
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

      {/* Due Date */}
      <PropertyRow label="Due date">
        <DatePickerField
          ghost
          value={task.dueDate}
          onChange={onDueDateChange}
          placeholder="No due date"
          overdue={task.dueDate ? isOverdue(task.dueDate) : false}
        />
      </PropertyRow>

      {detailsVisible && (
        <>
          {/* Planned Start */}
          {shown.plannedStart && (
            <PropertyRow label="Planned start">
              <DatePickerField
                ghost
                value={task.plannedStartDate}
                onChange={onStartDateChange}
                placeholder="No planned start"
                defaultOpen={justAdded("plannedStart")}
              />
            </PropertyRow>
          )}

          {/* Estimate */}
          {shown.estimate && (
            <PropertyRow label="Estimate">
              <Select
                value={task.estimate != null ? String(task.estimate) : "none"}
                onValueChange={(val) => {
                  if (val !== null) onEstimateChange(val === "none" ? null : Number(val));
                }}
                defaultOpen={justAdded("estimate")}
              >
                <SelectTrigger className={PROPERTY_TRIGGER_CLASS}>
                  <SelectValue>
                    <div className="flex items-center gap-2 w-full">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {task.estimate != null
                          ? formatEstimate(task.estimate)
                          : "No estimate"}
                      </span>
                      {task.estimate != null && (() => {
                        const { plan, commit } = computeHofstadterLabels(task.estimate);
                        return (
                          <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
                            <span>{plan}</span>
                            <span>{commit}</span>
                          </span>
                        );
                      })()}
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
          )}

          {/* Tags — the picker searches and creates, so it is the only way in. */}
          {!hideTags && tagsRow}

          {addable.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {addable.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAdded((prev) => new Set(prev).add(p))}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground pointer-coarse:py-2"
                >
                  <Plus className="h-3 w-3" />
                  {OPTIONAL_LABELS[p]}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {collapsible && (
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          className="flex items-center gap-1 rounded-md px-2 py-1 -ml-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground pointer-coarse:py-2"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")}
          />
          {detailsOpen ? "Fewer details" : "More details"}
        </button>
      )}
    </div>
  );
}
