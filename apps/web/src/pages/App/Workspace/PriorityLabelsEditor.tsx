import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import { Flag } from "lucide-react";
import {
  expandPriorityPattern,
  PRIORITIES,
  PRIORITY_PLACEHOLDER,
  type PriorityLabelMap,
} from "@/lib/priority-label-pattern";

type Props = {
  link: {
    _id: Id<"projectIntegrationLinks">;
    priorityLabels?: PriorityLabelMap;
  };
  /** "GitHub" / "GitLab" — for the copy only. */
  providerTitle: string;
};

const EMPTY: PriorityLabelMap = { urgent: "", high: "", medium: "", low: "" };

const PRIORITY_TITLE: Record<(typeof PRIORITIES)[number], string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Per-link priority ↔ label map: which provider label stands for each Ripple
 * priority. Admin-only (the mutation gates). Four inputs plus a "Fill from
 * pattern" shortcut that expands `{priority}` into all four without saving;
 * Save is the only write, Clear empties all four (which the server stores as
 * "no map"). Validation — every slot filled, four distinct names, none a
 * repo-routing tag — is the server's, surfaced as the toast.
 */
export function PriorityLabelsEditor({ link, providerTitle }: Props) {
  const setPriorityLabels = useMutation(
    api.integrations.core.links.setPriorityLabels,
  );

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<PriorityLabelMap>(
    link.priorityLabels ?? EMPTY,
  );
  const [pattern, setPattern] = useState("");
  const [saving, setSaving] = useState(false);

  const stored = link.priorityLabels ?? EMPTY;
  const hasChanges = PRIORITIES.some(
    (p) => values[p].trim().toLowerCase() !== stored[p],
  );
  const expanded = expandPriorityPattern(pattern);

  const save = async () => {
    setSaving(true);
    try {
      await setPriorityLabels({ linkId: link._id, priorityLabels: values });
      toast.success("Priority labels saved");
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
        <Flag className="h-3.5 w-3.5" />
        Priority labels
        {link.priorityLabels && (
          <span className="font-mono text-foreground">
            ({link.priorityLabels.urgent} … {link.priorityLabels.low})
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">
          {providerTitle} label for each priority
        </div>
        <p className="text-[11px] text-muted-foreground">
          Changing a task&apos;s priority swaps this label on the issue, and
          labeling the issue sets the priority here. These labels never become
          tags.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={`priority/${PRIORITY_PLACEHOLDER}`}
          className="h-7 font-mono text-xs"
          aria-label="Label pattern"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-xs"
          disabled={!expanded}
          onClick={() => {
            if (expanded) setValues(expanded);
          }}
        >
          Fill from pattern
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PRIORITIES.map((p) => (
          <label key={p} className="space-y-1 text-xs">
            <span className="text-muted-foreground">{PRIORITY_TITLE[p]}</span>
            <Input
              value={values[p]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [p]: e.target.value }))
              }
              className="h-7 font-mono text-xs"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setValues(EMPTY)}
        >
          Clear
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setValues(link.priorityLabels ?? EMPTY);
              setPattern("");
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
