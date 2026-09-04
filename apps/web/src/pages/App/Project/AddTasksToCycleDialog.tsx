import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@ripple/ui/components/input";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { formatTaskId } from "@/lib/task-utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/** Rows asked of the server per page — the scroll box shows about eight. */
const PICKER_LIMIT = 50;

type Suggestion = NonNullable<
  ReturnType<typeof useQuery<typeof api.cycles.suggestAddableTasks>>
>[number];

// ────────────────────────────────────────────────────────────────────────────
// Task selection list (presentational)
// ────────────────────────────────────────────────────────────────────────────

function AddTasksList({
  suggestions,
  searching,
  selected,
  onToggle,
  search,
  onSearchChange,
}: {
  suggestions: Suggestion[] | undefined;
  searching: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <>
      <Input
        placeholder="Search tasks…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="max-h-64 overflow-y-auto space-y-1 mt-2">
        {suggestions === undefined ? (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
        ) : suggestions.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {searching ? "No tasks match." : "No more tasks to add."}
          </div>
        ) : (
          suggestions.map((task) => {
            const ref = formatTaskId(task.projectKey, task.number);
            return (
              <button
                key={task._id}
                onClick={() => onToggle(task._id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors",
                  selected.has(task._id)
                    ? "bg-primary/10"
                    : "hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                    selected.has(task._id)
                      ? "bg-primary border-primary"
                      : "border-input"
                  )}
                >
                  {selected.has(task._id) && (
                    <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {ref && (
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{ref}</span>
                )}
                <span
                  className={cn("flex-1 min-w-0 truncate", task.completed && "text-muted-foreground")}
                >
                  {task.title}
                </span>
                {/* Completed tasks only surface through search (see
                    `cycles.suggestAddableTasks`); mark them so a retroactive
                    add is a deliberate one. */}
                {task.completed ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Completed" />
                ) : task.statusColor ? (
                  <span className={cn("w-2 h-2 rounded-full shrink-0", task.statusColor)} />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dialog (responsive: Drawer on mobile, Dialog on desktop)
// ────────────────────────────────────────────────────────────────────────────

interface AddTasksToCycleDialogProps {
  cycleId: Id<"cycles">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddTasksToCycleDialog({
  cycleId,
  open,
  onOpenChange,
}: AddTasksToCycleDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const trimmed = search.trim();
  // Server-driven, bounded, and already minus the cycle's own tasks. Browse
  // mode offers active tasks only; a typed query also matches completed ones.
  const suggestions = useQuery(
    api.cycles.suggestAddableTasks,
    open ? { cycleId, query: trimmed || undefined, limit: PICKER_LIMIT } : "skip",
  );
  const addTasks = useMutation(api.cycles.addTasks);

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setSearch("");
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await addTasks({ cycleId, taskIds: [...selected] as Id<"tasks">[] });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const addButtonLabel = selected.size > 0
    ? `Add ${selected.size} task${selected.size > 1 ? "s" : ""}`
    : "Add tasks";

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add tasks to cycle</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="my-2">
          <AddTasksList
            suggestions={suggestions}
            searching={trimmed.length > 0}
            selected={selected}
            onToggle={handleToggle}
            search={search}
            onSearchChange={setSearch}
          />
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleAdd()} disabled={selected.size === 0 || saving}>
            {addButtonLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
