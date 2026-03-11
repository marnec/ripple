import { FavoriteFilterButton } from "@/components/FavoriteFilterButton";
import { ResourceSearchInput } from "@/components/ResourceSearchInput";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { favoriteFilterToBoolean, useDebouncedSearch } from "@/hooks/use-debounced-search";
import { Plus } from "lucide-react";
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
    resetKey,
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
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ResourceSearchInput
              key={resetKey}
              workspaceId={wsId}
              value={localSearchValue}
              onChange={handleSearchChange}
              onSubmit={handleSearchSubmit}
              placeholder={`Search ${title.toLowerCase()}...${showFavorites ? " #tag to filter" : ""}`}
            />
          </div>
          {showFavorites && (
            <FavoriteFilterButton value={isFavorite} onToggle={handleFavoriteToggle} />
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
          isFavorite={favoriteFilterToBoolean(isFavorite)}
          favoriteFilter={isFavorite}
          onLoadingChange={handleLoadingChange}
          showFavorites={showFavorites}
        />
      </div>
      {createDialog}
    </div>
  );
}
