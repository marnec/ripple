import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Bulk selection over a rendered task list (on mobile, entered by long-press
 * — see `Tasks.tsx`). Ids, not rows: the selection is intersected with what is
 * visible on every render, so tasks a bulk action removes, or a filter hides,
 * drop out of the count. Shift-click selects the range from the last toggled
 * row.
 */
export function useTaskSelection<T extends { _id: Id<"tasks"> }>(visible: T[] | undefined) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<Id<"tasks">>>(() => new Set());
  const [anchor, setAnchor] = useState<Id<"tasks"> | null>(null);
  const rows = visible ?? [];
  const selectedTasks = rows.filter((t) => selectedIds.has(t._id));

  const toggle = (taskId: Id<"tasks">, selected: boolean, shiftKey: boolean) => {
    const from = anchor ? rows.findIndex((t) => t._id === anchor) : -1;
    const to = rows.findIndex((t) => t._id === taskId);
    const range =
      shiftKey && from !== -1 && to !== -1
        ? rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((t) => t._id)
        : [taskId];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of range) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setAnchor(taskId);
  };

  const clear = () => {
    setSelectedIds(new Set());
    setAnchor(null);
  };

  const selectAll = () => setSelectedIds(new Set(rows.map((t) => t._id)));

  return {
    isSelected: (taskId: Id<"tasks">) => selectedIds.has(taskId),
    selectedTasks,
    active: selectedTasks.length > 0,
    toggle,
    clear,
    selectAll,
  };
}
