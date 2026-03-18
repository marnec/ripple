import { useQuery } from "convex/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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
};

export function CommandPalette({ workspaceId, open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const hasSearch = search.trim().length > 0;

  // Recent items from localStorage (shown when search is empty)
  const recents = useLocalRecents(hasSearch ? undefined : workspaceId, 8);

  // Search queries (fired when search is non-empty)
  const channels = useQuery(
    api.channels.search,
    hasSearch ? { workspaceId, searchText: search } : "skip",
  );
  const documents = useQuery(
    api.documents.search,
    hasSearch ? { workspaceId, searchText: search } : "skip",
  );
  const diagrams = useQuery(
    api.diagrams.search,
    hasSearch ? { workspaceId, searchText: search } : "skip",
  );
  const spreadsheets = useQuery(
    api.spreadsheets.search,
    hasSearch ? { workspaceId, searchText: search } : "skip",
  );
  const projects = useQuery(
    api.projects.search,
    hasSearch ? { workspaceId, searchText: search } : "skip",
  );

  const searchGroups = (() => {
    if (!hasSearch) return [];
    return [
      { type: "channel" as const, label: "Channels", items: channels },
      { type: "document" as const, label: "Documents", items: documents },
      { type: "diagram" as const, label: "Diagrams", items: diagrams },
      { type: "spreadsheet" as const, label: "Spreadsheets", items: spreadsheets },
      { type: "project" as const, label: "Projects", items: projects },
    ].filter((g) => g.items && g.items.length > 0);
  })();

  const handleSelect = (resourceType: string, resourceId: string) => {
    onOpenChange(false);
    setSearch("");
    void navigate(getResourceUrl(workspaceId, resourceType, resourceId));
  };

  return (
    <CommandDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSearch(""); }}>
      <CommandInput
        placeholder="Search or jump to..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
            {group.items!.map((item) => {
              const Icon = RESOURCE_TYPE_ICONS[group.type];
              return (
                <CommandItem
                  key={item._id}
                  value={`${item.name} ${group.type}`}
                  onSelect={() => handleSelect(group.type, item._id)}
                >
                  {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {RESOURCE_TYPE_LABELS[group.type]}
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
