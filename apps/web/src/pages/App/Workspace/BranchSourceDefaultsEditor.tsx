import { useEffect, useId, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GitBranchPlus } from "lucide-react";

type Props = {
  link: {
    _id: Id<"projectIntegrationLinks">;
    defaultBaseBranch?: string;
    askBranchSourceEachTime?: boolean;
  };
};

/**
 * Per-link "Create branch" source defaults: the base branch new task branches
 * are cut from (empty = the repo's default branch) and whether the task button
 * prompts for the base each time. Admin-only (mirrors the picker's "don't ask
 * again"). The branch field is a datalist — suggests repo branches but accepts
 * free text so a not-yet-created base can be pre-configured.
 */
export function BranchSourceDefaultsEditor({ link }: Props) {
  const setDefaults = useMutation(
    api.integrations.core.links.setBranchSourceDefaults,
  );
  const listBranches = useAction(
    api.integrations.github.branchesAction.listRepoBranches,
  );

  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(link.defaultBaseBranch ?? "");
  // Absent setting = ask (the default before anyone configures it).
  const [ask, setAsk] = useState(link.askBranchSourceEachTime ?? true);
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
        /* free-text fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [open, link._id, listBranches]);

  const trimmed = base.trim();
  const hasChanges =
    trimmed !== (link.defaultBaseBranch ?? "") ||
    ask !== (link.askBranchSourceEachTime ?? true);

  const save = async () => {
    setSaving(true);
    try {
      await setDefaults({
        linkId: link._id,
        defaultBaseBranch: trimmed === "" ? null : trimmed,
        askEachTime: ask,
      });
      toast.success("Branch source saved");
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
        <GitBranchPlus className="h-3.5 w-3.5" />
        Branch source
        {link.defaultBaseBranch && (
          <span className="font-mono text-foreground">
            ({link.defaultBaseBranch})
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1.5">
        <label
          htmlFor={`${listId}-base`}
          className="text-xs font-medium text-muted-foreground"
        >
          New task branches are cut from
        </label>
        <datalist id={`${listId}-options`}>
          {branchOptions.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Input
          id={`${listId}-base`}
          list={`${listId}-options`}
          value={base}
          placeholder="repo default branch"
          onChange={(e) => setBase(e.target.value)}
          className="h-8 font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Leave empty to use the repository&apos;s default branch.
        </p>
      </div>

      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Ask which branch each time
        </span>
        <Switch checked={ask} onCheckedChange={setAsk} />
      </label>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setBase(link.defaultBaseBranch ?? "");
            setAsk(link.askBranchSourceEachTime ?? true);
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
  );
}
