import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RippleSpinner } from "@/components/RippleSpinner";
import { useLocalRecents } from "@/hooks/use-local-recents";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { getResourceUrl } from "@/lib/resource-urls";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";

interface CommandPaletteProps {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  channel: "Channel",
  document: "Document",
  diagram: "Diagram",
  spreadsheet: "Spreadsheet",
  project: "Project",
  user: "Send DM",
};

export function CommandPalette({ workspaceId, open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const createDm = useMutation(api.channels.createDm);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const isDebouncing = search.trim() !== debouncedSearch.trim();
  const hasSearch = debouncedSearch.trim().length > 0;

  // Recent items from localStorage (shown when search is empty)
  const recents = useLocalRecents(hasSearch ? undefined : workspaceId, 8);

  // Single cross-resource search via nodes table
  const nodeResults = useQuery(
    api.nodes.search,
    hasSearch ? { workspaceId, searchText: debouncedSearch } : "skip",
  );

  const isLoading = search.trim().length > 0 && (isDebouncing || (hasSearch && nodeResults === undefined));

  const GROUP_LABELS: Record<string, string> = {
    channel: "Channels",
    document: "Documents",
    diagram: "Diagrams",
    spreadsheet: "Spreadsheets",
    project: "Projects",
    user: "People",
  };

  const searchGroups = (() => {
    if (!hasSearch || !nodeResults) return [];
    // Group by resourceType, exclude tasks (not navigable from command palette)
    const byType = new Map<string, typeof nodeResults>();
    for (const node of nodeResults) {
      if (node.resourceType === "task") continue;
      const group = byType.get(node.resourceType) ?? [];
      group.push(node);
      byType.set(node.resourceType, group);
    }
    return [...byType.entries()]
      .map(([type, items]) => ({ type, label: GROUP_LABELS[type] ?? type, items }))
      .filter((g) => g.items.length > 0);
  })();

  const handleSelect = (resourceType: string, resourceId: string) => {
    if (resourceType === "user") {
      createDm({ workspaceId, otherUserId: resourceId as Id<"users"> })
        .then((channelId) => {
          onOpenChange(false);
          setSearch("");
          void navigate(`/workspaces/${workspaceId}/channels/${channelId}`);
        })
        .catch(() => {
          toast.error("Error starting conversation", {
            description: "Please try again",
          });
        });
      return;
    }
    onOpenChange(false);
    setSearch("");
    void navigate(getResourceUrl(workspaceId, resourceType, resourceId));
  };

  return (
    <CommandDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSearch(""); }}>
      <div className="relative">
        <CommandInput
          placeholder="Search or jump to..."
          value={search}
          onValueChange={setSearch}
        />
        {isLoading && (
          <div className="pointer-events-none absolute right-2 top-0 flex h-full items-center pb-0 pt-1 text-muted-foreground">
            <RippleSpinner size={16} color="currentColor" />
          </div>
        )}
      </div>
      <CommandList>
        {!isLoading && <CommandEmpty>No results found.</CommandEmpty>}

        {/* Recent items when search is empty */}
        {!hasSearch && recents.length > 0 && (
          <CommandGroup heading="Recent">
            {recents.map((item) => {
              const Icon = RESOURCE_TYPE_ICONS[item.resourceType as keyof typeof RESOURCE_TYPE_ICONS];
              return (
                <CommandItem
                  key={item.resourceId}
                  value={`${item.resourceName} ${item.resourceType}`}
                  onSelect={() => handleSelect(item.resourceType, item.resourceId)}
                >
                  {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{item.resourceName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {RESOURCE_TYPE_LABELS[item.resourceType] ?? item.resourceType}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Search results */}
        {searchGroups.map((group) => (
          <CommandGroup key={group.type} heading={group.label}>
            {group.items.map((item) => {
              const Icon = RESOURCE_TYPE_ICONS[group.type];
              return (
                <CommandItem
                  key={item.resourceId}
                  value={`${item.name} ${group.type}`}
                  onSelect={() => handleSelect(group.type, item.resourceId)}
                >
                  {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {GROUP_LABELS[group.type] ?? group.type}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
