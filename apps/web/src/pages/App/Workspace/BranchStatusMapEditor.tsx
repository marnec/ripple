import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitMerge, Plus, X } from "lucide-react";
import { BranchPicker } from "./BranchPicker";

type Entry = { branch: string; statusId: Id<"taskStatuses"> };

// Editable rows carry a stable client id so React keys survive insert/remove
// without mis-associating input state (index keys corrupt the typed value of
// sibling rows when one is deleted). The id is stripped before saving.
type Row = Entry & { id: string };

const toRows = (entries: Entry[]): Row[] =>
  entries.map((e) => ({ ...e, id: crypto.randomUUID() }));

type Props = {
  link: {
    _id: Id<"projectIntegrationLinks">;
    projectId: Id<"projects">;
    branchStatusMap?: Entry[];
  };
};

/**
 * Per-link branch→status automation editor. When a PR merges into a mapped
 * branch, linked tasks advance to the mapped status (forward-only). The
 * branch field is a live picker backed by GitHub's branch list; a custom
 * branch name can still be typed to pre-configure one that doesn't exist yet.
 */
export function BranchStatusMapEditor({ link }: Props) {
  const statuses = useQuery(api.taskStatuses.listByProject, {
    projectId: link.projectId,
  });
  const setMap = useMutation(api.integrations.core.links.setBranchStatusMap);

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => toRows(link.branchStatusMap ?? []));
  const [saving, setSaving] = useState(false);

  const mappable = (statuses ?? []).filter((s) => !s.isTriage);

  // A branch can map to only one status, so a branch already used by any row
  // is excluded from the other rows' picker (and from the row added by
  // "Add mapping"). The BranchPicker keeps the row's own value visible even
  // when the excluded list contains it.
  const usedBranches = Array.from(
    new Set(rows.map((r) => r.branch.trim()).filter((b) => b !== "")),
  );

  // Valid rows = a non-empty branch mapped to a status. Empty/whitespace
  // branches are dropped (an in-progress row is not a mapping yet).
  const cleaned = rows
    .filter((r) => r.branch.trim() !== "")
    .map((r) => ({ branch: r.branch.trim(), statusId: r.statusId }));

  // Order-insensitive comparison so reordering rows alone isn't "a change".
  const normalize = (entries: Entry[]) =>
    JSON.stringify(
      [...entries].sort((a, b) =>
        (a.branch + a.statusId).localeCompare(b.branch + b.statusId),
      ),
    );

  const hasChanges =
    normalize(cleaned) !== normalize(link.branchStatusMap ?? []);

  const save = async () => {
    setSaving(true);
    try {
      await setMap({ linkId: link._id, entries: cleaned });
      toast.success("Branch automation saved");
    } catch (err) {
      toast.error("Couldn't save", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <GitMerge className="h-3.5 w-3.5" />
        Branch automation
        {link.branchStatusMap && link.branchStatusMap.length > 0 && (
          <span className="text-foreground">
            ({link.branchStatusMap.length})
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <GitMerge className="h-3.5 w-3.5" />
        When a PR merges into…
      </div>

      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <BranchPicker
              linkId={link._id}
              value={row.branch}
              onChange={(branch) =>
                setRows((rs) =>
                  rs.map((r) => (r.id === row.id ? { ...r, branch } : r)),
                )
              }
              excludedBranches={usedBranches}
              placeholder="select branch"
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Select
              value={row.statusId}
              onValueChange={(value) =>
                setRows((rs) =>
                  rs.map((r) =>
                    r.id === row.id
                      ? { ...r, statusId: value as Id<"taskStatuses"> }
                      : r,
                  ),
                )
              }
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue placeholder="status">
                  {(value) =>
                    (statuses ?? []).find((s) => s._id === value)?.name ??
                    "status"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {mappable.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              aria-label="Remove mapping"
              onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={mappable.length === 0}
            onClick={() => {
              const first = mappable[0];
              if (!first) return;
              setRows((rs) => [
                ...rs,
                {
                  id: crypto.randomUUID(),
                  branch: "",
                  statusId: first._id,
                },
              ]);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add mapping
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setRows(toRows(link.branchStatusMap ?? []));
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={saving || !hasChanges}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
