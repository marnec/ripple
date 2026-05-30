import type { Id } from "@convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { type EnrichedTask, PRIORITY_COLORS, formatDayTitle } from "./calendar-events";

export function DayScheduleDrawer({
  date,
  open,
  onOpenChange,
  allTasks,
  unscheduledTasks,
  onSchedule,
  onUnschedule,
}: {
  date: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTasks: EnrichedTask[];
  unscheduledTasks: EnrichedTask[];
  onSchedule: (taskId: Id<"tasks">, date: string) => void;
  onUnschedule: (taskId: Id<"tasks">) => void;
}) {
  if (!date) return null;

  const scheduledToday = allTasks.filter(
    (t) => t.plannedStartDate === date && !t.completed,
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="max-h-[70vh]">
        <DrawerHeader>
          <DrawerTitle>{formatDayTitle(date)}</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto pb-safe">
          {scheduledToday.length > 0 && (
            <section className="px-4 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Scheduled
              </p>
              <div className="space-y-0.5">
                {scheduledToday.map((task) => (
                  <DayTaskRow
                    key={task._id}
                    task={task}
                    checked
                    onToggle={() => onUnschedule(task._id as Id<"tasks">)}
                  />
                ))}
              </div>
            </section>
          )}
          {unscheduledTasks.length > 0 && (
            <section className="px-4 pb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Unscheduled
              </p>
              <div className="space-y-0.5">
                {unscheduledTasks.map((task) => (
                  <DayTaskRow
                    key={task._id}
                    task={task}
                    checked={false}
                    onToggle={() => onSchedule(task._id as Id<"tasks">, date)}
                  />
                ))}
              </div>
            </section>
          )}
          {scheduledToday.length === 0 && unscheduledTasks.length === 0 && (
            <p className="px-4 pb-6 text-sm text-muted-foreground text-center">
              No tasks
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DayTaskRow({
  task,
  checked,
  onToggle,
}: {
  task: EnrichedTask;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 px-1 py-2 rounded hover:bg-muted cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: PRIORITY_COLORS[task.priority] ?? "#6b7280" }}
      />
      <span className="text-sm truncate">{task.title}</span>
    </label>
  );
}
