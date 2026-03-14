import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

// ────────────────────────────────────────────────────────────────────────────
// Task selection list (presentational)
// ────────────────────────────────────────────────────────────────────────────

function AddTasksList({
  allTasks,
  available,
  existingTaskIds,
  selected,
  onToggle,
  search,
  onSearchChange,
}: {
  allTasks: { _id: string; title: string; status?: { color: string } | null }[] | undefined;
  available: { _id: string; title: string; status?: { color: string } | null }[];
  existingTaskIds: Set<string>;
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
        autoFocus
      />

      <div className="max-h-64 overflow-y-auto space-y-1 mt-2">
        {allTasks === undefined ? (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
        ) : available.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {allTasks.length === existingTaskIds.size
              ? "All tasks are already in this cycle."
              : "No tasks match."}
          </div>
        ) : (
          available.map((task) => (
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
              <span className="flex-1 min-w-0 truncate">{task.title}</span>
              {task.status && (
                <span
                  className={cn("w-2 h-2 rounded-full shrink-0", task.status.color)}
                />
              )}
            </button>
          ))
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
  projectId: Id<"projects">;
  existingTaskIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddTasksToCycleDialog({
  cycleId,
  projectId,
  existingTaskIds,
  open,
  onOpenChange,
}: AddTasksToCycleDialogProps) {
  const allTasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const addTask = useMutation(api.cycles.addTask);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const available = (allTasks ?? []).filter(
    (t) =>
      !existingTaskIds.has(t._id) &&
      t.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        [...selected].map((taskId) =>
          addTask({ cycleId, taskId: taskId as Id<"tasks"> })
        )
      );
      setSelected(new Set());
      setSearch("");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
    }
    onOpenChange(open);
  };

  const addButtonLabel = selected.size > 0
    ? `Add ${selected.size} task${selected.size > 1 ? "s" : ""}`
    : "Add tasks";

  const listProps = {
    allTasks,
    available,
    existingTaskIds,
    selected,
    onToggle: handleToggle,
    search,
    onSearchChange: setSearch,
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add tasks to cycle</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="my-2">
          <AddTasksList {...listProps} />
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
