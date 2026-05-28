import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GitBranchPlus } from "lucide-react";
import { BranchPicker } from "./BranchPicker";

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
 * again"). The branch field is a live picker backed by GitHub's branch list;
 * a custom name can still be typed to pre-configure a base that doesn't exist
 * yet.
 */
export function BranchSourceDefaultsEditor({ link }: Props) {
  const setDefaults = useMutation(
    api.integrations.core.links.setBranchSourceDefaults,
  );

  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(link.defaultBaseBranch ?? "");
  // Absent setting = ask (the default before anyone configures it).
  const [ask, setAsk] = useState(link.askBranchSourceEachTime ?? true);
  const [saving, setSaving] = useState(false);

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
        <div className="text-xs font-medium text-muted-foreground">
          New task branches are cut from
        </div>
        <BranchPicker
          linkId={link._id}
          value={base}
          onChange={setBase}
          placeholder="repo default branch"
          clearLabel="Use repository default"
          className="w-full"
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
