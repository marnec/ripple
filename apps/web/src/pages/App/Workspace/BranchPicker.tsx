import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { Check, ChevronsUpDown, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  linkId: Id<"projectIntegrationLinks">;
  value: string;
  onChange: (next: string) => void;
  // Branches to hide from the list (e.g. already mapped in a sibling row).
  // The currently selected `value` is never hidden — the row must always show
  // its own selection even when it's "used".
  excludedBranches?: readonly string[];
  // Shown in the trigger when `value` is empty.
  placeholder?: string;
  // Width override for the trigger (the popover follows the trigger width).
  className?: string;
  // When true, the user can commit a search string that doesn't match any
  // fetched branch — supports pre-configuring a not-yet-created branch. Default
  // true (matches the prior datalist behavior).
  allowFreeText?: boolean;
  // Render a dedicated "clear" option at the top of the list with this label.
  // For settings where "no value" carries a meaning (e.g. "use the repo's
  // default branch"). Omit to hide the option entirely.
  clearLabel?: string;
  disabled?: boolean;
};

/**
 * Single-select branch picker backed by the live GitHub branch list. Fetches
 * once on first open via `listRepoBranches({ linkId })`, with a manual refresh
 * for when the user just created a branch on GitHub. Supports free-text
 * commit (the editors need to pre-configure branches that don't exist yet);
 * when search has no match a "Use '…'" affordance commits the typed value.
 */
export function BranchPicker({
  linkId,
  value,
  onChange,
  excludedBranches = [],
  placeholder = "select branch",
  className,
  allowFreeText = true,
  clearLabel,
  disabled = false,
}: Props) {
  const listBranches = useAction(
    api.integrations.core.branchesAction.listRepoBranches,
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // One-shot guard so we don't refetch on every reopen — admins explicitly
  // refresh with the in-popover button. Lazy fetch fires from the open
  // event handler below (not an effect) per React's "don't sync on events" rule.
  const [hasFetched, setHasFetched] = useState(false);

  const fetchBranches = () => {
    setLoading(true);
    void listBranches({ linkId })
      .then((branches) => {
        setOptions(branches);
        setHasFetched(true);
      })
      .catch(() => {
        // Auth/resolution failure — fall back to free-text only. Leave
        // `hasFetched=false` so the refresh button retries.
      })
      .finally(() => setLoading(false));
  };

  // Hide siblings' already-mapped branches but never the row's own value.
  const visibleOptions = useMemo(() => {
    const excluded = new Set(excludedBranches);
    return options.filter((b) => b === value || !excluded.has(b));
  }, [options, excludedBranches, value]);

  // Custom client-side filter (cmdk's built-in lowercases + tokenizes; for
  // exact branch names a startsWith/includes is more predictable).
  const trimmedSearch = search.trim();
  const filteredOptions = useMemo(() => {
    if (trimmedSearch === "") return visibleOptions;
    const q = trimmedSearch.toLowerCase();
    return visibleOptions.filter((b) => b.toLowerCase().includes(q));
  }, [visibleOptions, trimmedSearch]);

  const exactMatch = visibleOptions.includes(trimmedSearch);
  const canCommitCustom =
    allowFreeText && trimmedSearch !== "" && !exactMatch && trimmedSearch !== value;

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !hasFetched && !loading) fetchBranches();
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-8 justify-between gap-1.5 font-mono text-xs",
              !value && "text-muted-foreground font-sans",
              className,
            )}
            type="button"
          />
        }
      >
        <span className="flex items-center gap-1.5 truncate">
          <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate">{value || placeholder}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--anchor-width)", minWidth: "16rem" }}
        align="start"
      >
        <Command shouldFilter={false}>
          <div className="flex items-stretch gap-1 pr-1">
            <div className="flex-1">
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search branches…"
              />
            </div>
            <button
              type="button"
              aria-label="Refresh branch list"
              disabled={loading}
              onClick={fetchBranches}
              className="my-1 self-stretch rounded-md px-2 text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
            </button>
          </div>
          <CommandList>
            {loading && options.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading branches…
              </div>
            ) : (
              <>
                {filteredOptions.length === 0 &&
                  !canCommitCustom &&
                  !clearLabel && (
                    <CommandEmpty>
                      {hasFetched
                        ? "No matching branches"
                        : "Couldn't load branches"}
                    </CommandEmpty>
                  )}
                {clearLabel && trimmedSearch === "" && (
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => commit("")}
                      className="text-xs"
                    >
                      <span className="flex-1 text-muted-foreground">
                        {clearLabel}
                      </span>
                      <Check
                        className={cn(
                          "ml-2 h-3.5 w-3.5",
                          value === "" ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  </CommandGroup>
                )}
                {filteredOptions.length > 0 && (
                  <CommandGroup>
                    {filteredOptions.map((b) => (
                      <CommandItem
                        key={b}
                        value={b}
                        onSelect={() => commit(b)}
                        className="font-mono text-xs"
                      >
                        <GitBranch className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        <span className="flex-1 truncate">{b}</span>
                        <Check
                          className={cn(
                            "ml-2 h-3.5 w-3.5",
                            b === value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {canCommitCustom && (
                  <>
                    {filteredOptions.length > 0 && <CommandSeparator />}
                    <CommandGroup heading="Use as custom branch">
                      <CommandItem
                        value={`__custom__${trimmedSearch}`}
                        onSelect={() => commit(trimmedSearch)}
                        className="text-xs"
                      >
                        Use{" "}
                        <span className="font-mono">
                          &quot;{trimmedSearch}&quot;
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
