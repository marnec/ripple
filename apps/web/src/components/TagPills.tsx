import { useQuery } from "convex-helpers/react/cache";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";

const TAG_NAME_MAX_LENGTH = 100;

type Props = {
  workspaceId: Id<"workspaces">;
  /** Tags rendered as removable pills. */
  value: string[];
  /** Add a tag (already normalized to trim+lowercase). */
  onAdd: (tag: string) => void;
  /** Remove a tag. */
  onRemove: (tag: string) => void;
  /**
   * Tags to hide from the add popover beyond those already in `value` (e.g. tags
   * claimed elsewhere in a one-tag-one-target mapping). `value` is always
   * excluded from the popover and always shown as pills.
   */
  excludedFromAdd?: Set<string>;
  disabled?: boolean;
  /** Noun in the add button + popover, e.g. "tag" → "+ tag" / "Add tag". */
  addLabel?: string;
};

/**
 * Inline tag pills with a "+ tag" add button. The pills are removable; the
 * button opens a searchable popover over the workspace tag dictionary
 * (create-on-the-fly supported). Shared by the create-task dialog (free tagging)
 * and the repo tag-routing settings (where `excludedFromAdd` hides tags already
 * routed to another repo). Mirrors the `TagPickerButton` popover idiom.
 */
export function TagPills({
  workspaceId,
  value,
  onAdd,
  onRemove,
  excludedFromAdd,
  disabled,
  addLabel = "tag",
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="gap-1 font-normal"
        >
          #{tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onRemove(tag)}
              className="-mr-0.5 rounded-full hover:bg-muted-foreground/20"
              title={`Remove #${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && (
        <AddTagPopover
          workspaceId={workspaceId}
          excluded={value}
          excludedFromAdd={excludedFromAdd}
          onPick={onAdd}
          addLabel={addLabel}
        />
      )}
    </div>
  );
}

function AddTagPopover({
  workspaceId,
  excluded,
  excludedFromAdd,
  onPick,
  addLabel,
}: {
  workspaceId: Id<"workspaces">;
  excluded: string[];
  excludedFromAdd?: Set<string>;
  onPick: (tag: string) => void;
  addLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allTags = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];

  const excludedSet = new Set(excluded);
  const available = allTags.filter(
    (t) => !excludedSet.has(t) && !excludedFromAdd?.has(t),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? available.filter((t) => t.includes(normalizedQuery))
    : available;
  const canCreate =
    normalizedQuery.length > 0 &&
    normalizedQuery.length <= TAG_NAME_MAX_LENGTH &&
    !excludedSet.has(normalizedQuery) &&
    !excludedFromAdd?.has(normalizedQuery) &&
    !allTags.includes(normalizedQuery);

  const pick = (tag: string) => {
    onPick(tag);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-input bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-accent hover:text-accent-foreground"
            title={`Add ${addLabel}`}
          />
        }
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <input
            type="text"
            placeholder={`Search or create ${addLabel}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                pick(normalizedQuery);
              }
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filtered.length === 0 && !canCreate ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">
              {available.length === 0 ? "No tags available" : "No tags"}
            </div>
          ) : (
            <>
              {filtered.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => pick(tag)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span>#{tag}</span>
                </button>
              ))}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => pick(normalizedQuery)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>
                    Create <span className="font-medium">#{normalizedQuery}</span>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
