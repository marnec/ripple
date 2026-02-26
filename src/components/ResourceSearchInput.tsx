import { parseSearchInput, type ParsedSearch } from "@/lib/search-utils";
import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";

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
  const existingTags = parseSearchInput(value).tags;
  const suggestions = cursorAtHashTag
    ? allTags.filter(
        (tag) =>
          tag.toLowerCase().includes(hashInput.toLowerCase()) &&
          !existingTags.includes(tag),
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

  const parsed = parseSearchInput(value);

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
              inputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {parsed.tags.length > 0 && !compact && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {parsed.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              #{tag}
            </Badge>
          ))}
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
