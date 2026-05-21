import { useEffect, useId, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitMerge, Plus, X } from "lucide-react";

type Entry = { branch: string; statusId: Id<"taskStatuses"> };

type Props = {
  link: {
    _id: Id<"projectIntegrationLinks">;
    projectId: Id<"projects">;
    branchStatusMap?: Entry[];
  };
};

/**
 * Per-link branch→status automation editor. When a PR merges into a mapped
 * branch, linked tasks advance to the mapped status (forward-only). Branch
 * field is a datalist: suggests the repo's branches but accepts free text so
 * a not-yet-created branch can be pre-configured.
 */
export function BranchStatusMapEditor({ link }: Props) {
  const statuses = useQuery(api.taskStatuses.listByProject, {
    projectId: link.projectId,
  });
  const setMap = useMutation(api.integrations.core.links.setBranchStatusMap);
  const listBranches = useAction(
    api.integrations.github.branchesAction.listRepoBranches,
  );

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Entry[]>(link.branchStatusMap ?? []);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listBranches({ linkId: link._id })
      .then((b) => {
        if (!cancelled) setBranchOptions(b);
      })
      .catch(() => {
        /* fall back to free-text only */
      });
    return () => {
      cancelled = true;
    };
  }, [open, link._id, listBranches]);

  const mappable = (statuses ?? []).filter((s) => !s.isTriage);

  const save = async () => {
    setSaving(true);
    try {
      await setMap({
        linkId: link._id,
        entries: rows.filter((r) => r.branch.trim() !== ""),
      });
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

      <datalist id={listId}>
        {branchOptions.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      <ul className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              list={listId}
              value={row.branch}
              placeholder="branch (e.g. main)"
              onChange={(e) =>
                setRows((rs) =>
                  rs.map((r, j) =>
                    j === i ? { ...r, branch: e.target.value } : r,
                  ),
                )
              }
              className="h-8 flex-1 font-mono text-xs"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Select
              value={row.statusId}
              onValueChange={(value) =>
                setRows((rs) =>
                  rs.map((r, j) =>
                    j === i
                      ? { ...r, statusId: value as Id<"taskStatuses"> }
                      : r,
                  ),
                )
              }
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue placeholder="status" />
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
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={mappable.length === 0}
          onClick={() => {
            const first = mappable[0];
            if (!first) return;
            setRows((rs) => [...rs, { branch: "", statusId: first._id }]);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add mapping
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setRows(link.branchStatusMap ?? []);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
