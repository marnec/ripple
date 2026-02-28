import { ResourceSearchInput } from "@/components/ResourceSearchInput";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { Plus, Star } from "lucide-react";
import { useCallback, useState } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import { SearchResults } from "./SearchResults";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";

type ResourceListPageProps = {
  resourceType: ResourceType;
  title: string;
  workspaceId: string;
  onCreate?: () => void;
  createLabel?: string;
  createDialog?: React.ReactNode;
  showFavorites?: boolean;
};

export function ResourceListPage({
  resourceType,
  title,
  workspaceId,
  onCreate,
  createLabel,
  createDialog,
  showFavorites = true,
}: ResourceListPageProps) {
  const wsId = workspaceId as Id<"workspaces">;
  const [isLoading, setIsLoading] = useState(true);

  const {
    localSearchValue,
    searchQuery,
    tags,
    isFavorite,
    isSearchDebouncing,
    handleSearchChange,
    handleSearchSubmit,
    handleFavoriteToggle,
  } = useDebouncedSearch(workspaceId, resourceType, showFavorites);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  return (
    <div className="container mx-auto p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {title} in this workspace.
            </p>
          </div>
          {onCreate && (
            <Button onClick={onCreate} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              {createLabel ?? `New ${resourceType}`}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ResourceSearchInput
              workspaceId={wsId}
              value={localSearchValue}
              onChange={handleSearchChange}
              onSubmit={handleSearchSubmit}
              placeholder={`Search ${title.toLowerCase()}...${showFavorites ? " #tag to filter" : ""}`}
            />
          </div>
          {showFavorites && (
            <button
              type="button"
              onClick={handleFavoriteToggle}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
                isFavorite
                  ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Star
                className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`}
              />
              Favorites
            </button>
          )}
          <div
            className="transition-opacity duration-200"
            style={{
              opacity: isSearchDebouncing || isLoading ? 1 : 0,
            }}
          >
            <RippleSpinner size={40} />
          </div>
        </div>
        <SearchResults
          workspaceId={wsId}
          resourceType={resourceType}
          searchText={searchQuery || undefined}
          tags={tags.length > 0 ? tags : undefined}
          isFavorite={isFavorite || undefined}
          onLoadingChange={handleLoadingChange}
          onCreate={onCreate}
          createLabel={createLabel}
          showFavorites={showFavorites}
        />
      </div>
      {createDialog}
    </div>
  );
}
