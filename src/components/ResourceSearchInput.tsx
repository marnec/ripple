import { buildSearchString, parseSearchInput, type ParsedSearch } from "@/lib/search-utils";
import { useQuery } from "convex/react";
import { Plus, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
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
  autoFocus?: boolean;
  compact?: boolean;
};

export function ResourceSearchInput({
  workspaceId,
  value: controlledValue,
  onChange,
  onSubmit,
  placeholder = "Search... #tag to filter",
  autoFocus,
  compact,
}: ResourceSearchInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
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

  const availableTags = allTags.filter((tag) => !parsed.tags.includes(tag));

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

  const addTag = (tag: string) => {
    const newValue = buildSearchString(parsed.searchText, [...parsed.tags, tag]);
    setValue(newValue);
    onSubmit?.(parseSearchInput(newValue));
    setTagPopoverOpen(false);
  };

  const removeTag = (tagToRemove: string) => {
    const newTags = parsed.tags.filter((t) => t !== tagToRemove);
    const newValue = buildSearchString(parsed.searchText, newTags);
    setValue(newValue);
    onSubmit?.(parseSearchInput(newValue));
  };

  return (
    <div className="relative">
      <div
        className={
          compact
            ? "flex items-center gap-1"
            : "flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        }
      >
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
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onSubmit?.({ searchText: "", tags: [] });
              inputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {!compact && (parsed.tags.length > 0 || availableTags.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {parsed.tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer gap-1 text-xs hover:bg-destructive/10 hover:text-destructive"
              onClick={() => removeTag(tag)}
            >
              #{tag}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          {availableTags.length > 0 && (
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger
                render={<button
                  type="button"
                  className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/30 px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                />}
              >
                  <Plus className="h-3 w-3" />
                  Tag
              </PopoverTrigger>
              <PopoverContent align="start" className="w-48 p-1">
                <div className="max-h-48 overflow-auto">
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
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
