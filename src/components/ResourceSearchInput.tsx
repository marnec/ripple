import { RippleSpinner } from "@/components/RippleSpinner";
import { buildSearchString, parseSearchInput, type ParsedSearch } from "@/lib/search-utils";
import { useQuery } from "convex-helpers/react/cache";
import { Check, Search, Tag as TagIcon, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";

type ResourceSearchInputProps = {
  workspaceId: Id<"workspaces">;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (parsed: ParsedSearch) => void;
  placeholder?: string;
  isLoading?: boolean;
};

export function ResourceSearchInput({
  workspaceId,
  value: controlledValue,
  onChange,
  onSubmit,
  placeholder = "Search... #tag to filter",
  isLoading,
}: ResourceSearchInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = controlledValue ?? internalValue;
  const setValue = (v: string) => {
    if (onChange) onChange(v);
    else setInternalValue(v);
  };

  const allTags: string[] = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];

  // Check if user is currently typing a #tag
  const cursorAtHashTag = value.match(/#(\w*)$/);
  const hashInput = cursorAtHashTag?.[1] ?? "";
  const parsed = parseSearchInput(value);
  const suggestions = cursorAtHashTag
    ? allTags.filter(
        (tag) =>
          tag.toLowerCase().includes(hashInput.toLowerCase()) &&
          !parsed.tags.includes(tag),
      )
    : [];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit?.(parseSearchInput(value));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const applySuggestion = (tag: string) => {
    // Replace the partial #tag at end with the full one
    const newValue = value.replace(/#\w*$/, `#${tag} `);
    setValue(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {isLoading ? (
          <RippleSpinner size={16} />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onSubmit?.({ searchText: "", tags: [] });
              inputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {suggestions.slice(0, 8).map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(tag)}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type TagFilterStripProps = {
  workspaceId: Id<"workspaces">;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (parsed: ParsedSearch) => void;
};

export function TagFilterStrip({ workspaceId, value, onChange, onSubmit }: TagFilterStripProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allTags: string[] = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];
  const parsed = parseSearchInput(value);

  if (allTags.length === 0 && parsed.tags.length === 0) return null;

  const filteredTags = query
    ? allTags.filter((t) => t.toLowerCase().includes(query.toLowerCase()))
    : allTags;
  const isActive = parsed.tags.length > 0;
  const buttonClass = isActive
    ? "border-border bg-accent text-accent-foreground"
    : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground";

  const apply = (tags: string[]) => {
    const next = buildSearchString(parsed.searchText, tags);
    onChange(next);
    onSubmit?.(parseSearchInput(next));
  };

  const toggleTag = (tag: string) => {
    if (parsed.tags.includes(tag)) {
      apply(parsed.tags.filter((t) => t !== tag));
    } else {
      apply([...parsed.tags, tag]);
    }
  };

  return (
    <>
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
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors sm:px-3 ${buttonClass}`}
            />
          }
        >
          <TagIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Tags</span>
          {isActive && (
            <span className="rounded-full bg-background/60 px-1.5 text-xs font-medium">
              {parsed.tags.length}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          {allTags.length > 5 && (
            <div className="border-b p-2">
              <input
                type="text"
                placeholder="Filter tags…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-64 overflow-auto p-1">
            {filteredTags.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">No tags</div>
            ) : (
              filteredTags.map((tag) => {
                const checked = parsed.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <Check className={`h-4 w-4 shrink-0 ${checked ? "opacity-100" : "opacity-0"}`} />
                    <span>#{tag}</span>
                  </button>
                );
              })
            )}
          </div>
          {isActive && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => apply([])}
                className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                Clear selected
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {parsed.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {parsed.tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer gap-1 text-xs hover:bg-destructive/10 hover:text-destructive"
              onClick={() => apply(parsed.tags.filter((t) => t !== tag))}
            >
              #{tag}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}
