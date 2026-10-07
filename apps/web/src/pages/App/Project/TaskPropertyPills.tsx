import { CalendarIcon, Check, Clock, Link2, Play, Plus, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Calendar } from "@/components/ui/calendar";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuLabel,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ESTIMATE_PRESETS,
  formatEstimate,
  getPriorityIcon,
  getPriorityLabel,
  isOverdue,
  parseISODate,
  toISODateString,
} from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { ExternalAssigneeAvatars, type ExternalAssignee } from "./ExternalAssignees";
import { BacklinksDrawer } from "@/components/BacklinksDrawer";
import { TagPickerButton } from "@/components/TagPickerButton";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";

type Priority = "urgent" | "high" | "medium" | "low";

/**
 * The app's button shape (`rounded-md`, as `Button size="sm"`), borderless
 * like the desktop property triggers (`PROPERTY_TRIGGER_CLASS`). Unlike those
 * it keeps a soft fill at rest: a phone has no hover, and without the row
 * labels and chevrons the desktop list leans on, a transparent "Medium"
 * would read as text rather than as a control.
 */
const PILL_CLASS =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-md bg-muted/40 px-2.5 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted/60";

/**
 * The time row is quieter than the pills: the same borderless "+ Planned
 * start" chips the desktop list uses to add an optional property. Unset, a
 * chip reads "+ Label"; set, it shows its icon and value.
 */
const TIME_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted/60 pointer-coarse:py-2";

/**
 * Every task property as pills — the compact form of the labelled rows, for a
 * phone where a row per property costs a screen's worth of height above the
 * description.
 *
 * Two rows, both always visible: who / how urgent / where it stands as
 * pills, followed by tag and reference counts as pills too (on a phone they
 * would otherwise crowd the header); then quieter chips (`TIME_CHIP_CLASS`) for
 * when and how big.
 * An unset chip reads "+ Label", so it is its own "add" control and there is
 * nothing to fold away.
 *
 * Each pill opens a bottom sheet on a phone and a dropdown or popover
 * elsewhere. The value *is* the control, so there are no labels; each menu
 * names itself in its first line instead.
 */
export function TaskPropertyPills({
  task,
  onSetTags,
  statuses,
  members,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
}: {
  task: {
    _id: Id<"tasks">;
    workspaceId: Id<"workspaces">;
    tags?: string[];
    statusId: Id<"taskStatuses">;
    status: { name: string; color: string } | null;
    priority: string;
    assigneeId?: Id<"users"> | null;
    assignee: { name?: string | null; image?: string } | null;
    externalAssignees?: ExternalAssignee[];
    dueDate?: string;
    plannedStartDate?: string;
    estimate?: number;
  };
  statuses: Array<{ _id: Id<"taskStatuses">; name: string; color: string }>;
  members: Array<{ userId: Id<"users">; name?: string | null; image?: string }>;
  onStatusChange: (statusId: Id<"taskStatuses">) => void;
  onPriorityChange: (priority: Priority) => void;
  /** A member's id, or `"unassigned"` — the same contract as the row form. */
  onAssigneeChange: (value: string) => void;
  onDueDateChange: (date: string | null) => void;
  onStartDateChange: (date: string | null) => void;
  onEstimateChange: (value: number | null) => void;
  onSetTags: (tags: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <ResponsiveDropdownMenu>
            {/* The avatar alone: whose task it is reads from the face, and
                the name is one tap away in the menu. */}
            <ResponsiveDropdownMenuTrigger
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={task.assignee ? `Assignee: ${task.assignee.name ?? "member"}` : "Assign"}
              title={task.assignee?.name ?? "Unassigned"}
            >
              {task.assignee ? (
                <UserAvatar
                  className="h-8 w-8"
                  name={task.assignee.name}
                  image={task.assignee.image}
                  alt={task.assignee.name ?? "Assignee"}
                  fallbackClassName="text-xs"
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dotted border-muted-foreground/60 text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </span>
              )}
            </ResponsiveDropdownMenuTrigger>
            <ResponsiveDropdownMenuContent align="start" className="w-56">
              <ResponsiveDropdownMenuLabel>Assignee</ResponsiveDropdownMenuLabel>
              <Option selected={!task.assigneeId} onSelect={() => onAssigneeChange("unassigned")}>
                <span className="text-muted-foreground">Unassigned</span>
              </Option>
              {members.map((member) => (
                <Option
                  key={member.userId}
                  selected={member.userId === task.assigneeId}
                  onSelect={() => onAssigneeChange(member.userId)}
                >
                  <UserAvatar
                    className="h-5 w-5"
                    name={member.name}
                    image={member.image}
                    alt={member.name ?? "Member"}
                    fallbackClassName="text-xs"
                  />
                  <span className="truncate">{member.name}</span>
                </Option>
              ))}
            </ResponsiveDropdownMenuContent>
          </ResponsiveDropdownMenu>
          <ExternalAssigneeAvatars
            assignees={task.externalAssignees}
            side="right"
            size="sm"
            className="shrink-0"
          />
        </div>

        <ResponsiveDropdownMenu>
          <ResponsiveDropdownMenuTrigger
            className={PILL_CLASS}
            aria-label={`Priority: ${getPriorityLabel(task.priority)}`}
          >
            {getPriorityIcon(task.priority)}
            <span>{getPriorityLabel(task.priority)}</span>
          </ResponsiveDropdownMenuTrigger>
          <ResponsiveDropdownMenuContent align="start" className="w-44">
            <ResponsiveDropdownMenuLabel>Priority</ResponsiveDropdownMenuLabel>
            {(["urgent", "high", "medium", "low"] as const).map((priority) => (
              <Option
                key={priority}
                selected={priority === task.priority}
                onSelect={() => onPriorityChange(priority)}
              >
                {getPriorityIcon(priority)}
                {getPriorityLabel(priority)}
              </Option>
            ))}
          </ResponsiveDropdownMenuContent>
        </ResponsiveDropdownMenu>

        <ResponsiveDropdownMenu>
          <ResponsiveDropdownMenuTrigger
            className={PILL_CLASS}
            aria-label={`Status: ${task.status?.name ?? "none"}`}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", task.status?.color)} />
            <span className="truncate">{task.status?.name ?? "No status"}</span>
          </ResponsiveDropdownMenuTrigger>
          <ResponsiveDropdownMenuContent align="start" className="w-52">
            <ResponsiveDropdownMenuLabel>Status</ResponsiveDropdownMenuLabel>
            {statuses.map((status) => (
              <Option
                key={status._id}
                selected={status._id === task.statusId}
                onSelect={() => onStatusChange(status._id)}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", status.color)} />
                {status.name}
              </Option>
            ))}
          </ResponsiveDropdownMenuContent>
        </ResponsiveDropdownMenu>
        {/* Counts, not names, so the row stays one line; the names are a
            tap away. */}
        <TagPickerButton
          workspaceId={task.workspaceId}
          value={task.tags ?? []}
          onChange={onSetTags}
          triggerVariant="chip"
          triggerClassName={PILL_CLASS}
        />
        <ReferencesChip taskId={task._id} workspaceId={task.workspaceId} />
      </div>

      <div className="-ml-2 flex flex-wrap items-center gap-1">
        <DatePill
          label="Due date"
          icon={<CalendarIcon className="h-3 w-3" />}
          value={task.dueDate}
          onChange={onDueDateChange}
          overdue={task.dueDate ? isOverdue(task.dueDate) : false}
        />
        <DatePill
          label="Planned start"
          icon={<Play className="h-3 w-3" />}
          value={task.plannedStartDate}
          onChange={onStartDateChange}
        />
        <ResponsiveDropdownMenu>
          <ResponsiveDropdownMenuTrigger
            className={cn(TIME_CHIP_CLASS, task.estimate != null && "text-foreground")}
            aria-label={
              task.estimate != null ? `Estimate: ${formatEstimate(task.estimate)}` : "Set estimate"
            }
          >
            {task.estimate != null ? (
              <>
                <Clock className="h-3 w-3" />
                {formatEstimate(task.estimate)}
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Estimate
              </>
            )}
          </ResponsiveDropdownMenuTrigger>
          <ResponsiveDropdownMenuContent align="start" className="w-40">
            <ResponsiveDropdownMenuLabel>Estimate</ResponsiveDropdownMenuLabel>
            <Option selected={task.estimate == null} onSelect={() => onEstimateChange(null)}>
              <span className="text-muted-foreground">No estimate</span>
            </Option>
            {ESTIMATE_PRESETS.map((hours) => (
              <Option
                key={hours}
                selected={task.estimate === hours}
                onSelect={() => onEstimateChange(hours)}
              >
                {formatEstimate(hours)}
              </Option>
            ))}
          </ResponsiveDropdownMenuContent>
        </ResponsiveDropdownMenu>
      </div>
    </div>
  );
}

/**
 * "🔗 2" — what references the task, opening the same drawer the desktop
 * toolbar's chain icon does. Absent when nothing references it: unlike the
 * other chips there is nothing to add from here.
 */
function ReferencesChip({
  taskId,
  workspaceId,
}: {
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
}) {
  const [open, setOpen] = useState(false);
  const count = useQuery(api.edges.getBacklinks, { targetId: taskId, workspaceId })?.references.length ?? 0;
  if (count === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={PILL_CLASS}
        aria-label={`Referenced in ${count} ${count === 1 ? "place" : "places"}`}
      >
        <Link2 className="h-3 w-3" />
        {count}
      </button>
      <BacklinksDrawer resourceId={taskId} workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * A date as a pill. A calendar is not a menu, so this is a bottom sheet on a
 * phone and a popover elsewhere rather than a `ResponsiveDropdownMenu` — same
 * split, done by hand. Picking a day closes it; "Clear" lives in the sheet,
 * not on the pill, so the pill stays one tap target.
 */
function DatePill({
  label,
  icon,
  value,
  onChange,
  overdue = false,
}: {
  label: string;
  icon: ReactNode;
  value?: string;
  onChange: (date: string | null) => void;
  overdue?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const triggerClass = cn(
    TIME_CHIP_CLASS,
    value && "text-foreground",
    overdue && "text-red-500 hover:text-red-500",
  );
  const triggerContent = value ? (
    <>
      {icon}
      {parseISODate(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
    </>
  ) : (
    <>
      <Plus className="h-3 w-3" />
      {label}
    </>
  );
  const ariaLabel = value
    ? `${label}: ${parseISODate(value).toLocaleDateString("en-US", { dateStyle: "medium" })}`
    : `Set ${label.toLowerCase()}`;

  const picker = (
    <div className="flex flex-col items-center gap-2">
      <Calendar
        mode="single"
        selected={value ? parseISODate(value) : undefined}
        onSelect={(date) => {
          onChange(date ? toISODateString(date) : null);
          setOpen(false);
        }}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          Clear {label.toLowerCase()}
        </Button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger className={triggerClass} aria-label={ariaLabel}>
          {triggerContent}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="px-4 pt-3 text-xs font-normal text-muted-foreground">
            {label}
          </DrawerTitle>
          <div className="p-3 pb-6">{picker}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={triggerClass} aria-label={ariaLabel}>
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        {picker}
      </PopoverContent>
    </Popover>
  );
}

function Option({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <ResponsiveDropdownMenuItem onSelect={onSelect} className="gap-2">
      {children}
      <Check className={cn("ml-auto h-4 w-4", !selected && "invisible")} />
    </ResponsiveDropdownMenuItem>
  );
}
