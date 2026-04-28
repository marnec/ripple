import { useQuery } from "convex-helpers/react/cache";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { cn } from "@/lib/utils";

type TagPickerButtonProps = {
  workspaceId: Id<"workspaces">;
  value: string[];
  onChange: (tags: string[]) => void;
  /**
   * "icon" — ghost icon button, suited to resource toolbars (default).
   * "pill" — outlined dashed pill labeled "Add tag", suited to inline
   *           tag rows (e.g. task properties). Always-visible affordance
   *           that prevents layout shift when the first tag is added.
   */
  triggerVariant?: "icon" | "pill";
};

const TAG_NAME_MAX_LENGTH = 100;

export function TagPickerButton({
  workspaceId,
  value,
  onChange,
  triggerVariant = "icon",
}: TagPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allTags = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTags = normalizedQuery
    ? allTags.filter((t) => t.includes(normalizedQuery))
    : allTags;
  const exactMatch = allTags.includes(normalizedQuery);
  const canCreate =
    normalizedQuery.length > 0 &&
    normalizedQuery.length <= TAG_NAME_MAX_LENGTH &&
    !exactMatch;

  const isActive = value.length > 0;

  const toggleTag = (tag: string) => {
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  };

  const createAndAdd = () => {
    if (!canCreate) return;
    if (!value.includes(normalizedQuery)) {
      onChange([...value, normalizedQuery]);
    }
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      {triggerVariant === "pill" ? (
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-input bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-accent hover:text-accent-foreground"
              title="Add tag"
            />
          }
        >
          <Plus className="h-3 w-3" />
          Add tag
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title={isActive ? `Tags (${value.length})` : "Add tag"}
            />
          }
        >
          <TagIcon
            className={cn(
              "h-4 w-4",
              isActive ? "fill-current text-foreground" : "text-muted-foreground",
            )}
          />
        </PopoverTrigger>
      )}
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <input
            type="text"
            placeholder="Search or create tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                createAndAdd();
              }
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filteredTags.length === 0 && !canCreate ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">No tags</div>
          ) : (
            <>
              {filteredTags.map((tag) => {
                const checked = value.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <Check className={cn("h-4 w-4 shrink-0", checked ? "opacity-100" : "opacity-0")} />
                    <span>#{tag}</span>
                  </button>
                );
              })}
              {canCreate && (
                <button
                  type="button"
                  onClick={createAndAdd}
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
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t p-2">
            {value.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer gap-1 text-xs hover:bg-destructive/10 hover:text-destructive"
                onClick={() => toggleTag(tag)}
              >
                #{tag}
                <X className="h-3 w-3" />
              </Badge>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Inline chip strip ────────────────────────────────────────────────
// Renders the resource's tags as a non-wrapping horizontal strip that
// clips on overflow. Used in resource toolbars to surface applied tags
// next to the title.

export function TagInlineStrip({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap sm:flex">
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="shrink-0 text-xs font-normal"
        >
          #{tag}
        </Badge>
      ))}
    </div>
  );
}

