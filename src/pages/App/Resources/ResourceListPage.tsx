import { ChannelVisibilityFilterButton } from "@/components/ChannelVisibilityFilterButton";
import { FavoriteFilterButton } from "@/components/FavoriteFilterButton";
import { ResourceSearchInput, TagFilterStrip } from "@/components/ResourceSearchInput";
import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { favoriteFilterToBoolean, useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SearchResults } from "./SearchResults";
import type { BrowsableResourceType as ResourceType } from "@shared/types/resources";

type ResourceListPageProps = {
  resourceType: ResourceType;
  title: string;
  workspaceId: string;
  onCreate?: () => void;
  createLabel?: string;
  createDialog?: React.ReactNode;
  showFavorites?: boolean;
  subPath?: string;
  secondaryAction?: React.ReactNode;
};

export function ResourceListPage({
  resourceType,
  title,
  workspaceId,
  onCreate,
  createLabel,
  createDialog,
  showFavorites = true,
  subPath,
  secondaryAction,
}: ResourceListPageProps) {
  const wsId = workspaceId as Id<"workspaces">;
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(true);

  const {
    localSearchValue,
    searchQuery,
    tags,
    isFavorite,
    channelVisibility,
    isSearchDebouncing,
    resetKey,
    handleSearchChange,
    handleSearchSubmit,
    handleFavoriteToggle,
    handleChannelVisibilityToggle,
  } = useDebouncedSearch(workspaceId, resourceType, showFavorites);

  const handleLoadingChange = (loading: boolean) => {
    setIsLoading(loading);
  };

  const showFilterStrip = showFavorites || resourceType === "channel" || tags.length > 0;

  const createButton = onCreate ? (
    <Button onClick={onCreate} size="sm">
      <Plus className="h-4 w-4 sm:mr-1.5" />
      <span className="hidden sm:inline">{createLabel ?? `New ${resourceType}`}</span>
    </Button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in">
      {/* Shared toolbar — title left, search center, actions right */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 border-b">
        <div className="flex h-8 flex-1 min-w-0 items-center gap-2">
          <h1 className="hidden sm:block text-lg font-semibold truncate">{title}</h1>
        </div>
        <div className="relative w-full max-w-md flex items-center">
          <ResourceSearchInput
            key={resetKey}
            workspaceId={wsId}
            value={localSearchValue}
            onChange={handleSearchChange}
            onSubmit={handleSearchSubmit}
            placeholder={`Search ${title.toLowerCase()}...${showFavorites ? " #tag to filter" : ""}`}
            isLoading={isSearchDebouncing || isLoading}
          />
        </div>
        <div className="flex h-8 flex-1 items-center justify-end gap-2">
          {!isMobile && secondaryAction}
          {!isMobile && createButton}
        </div>
      </div>

      {/* Content body */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-4 space-y-4">
          {showFilterStrip && (
            <div className="flex flex-wrap items-center gap-2">
              {showFavorites && (
                <FavoriteFilterButton value={isFavorite} onToggle={handleFavoriteToggle} />
              )}
              {resourceType === "channel" && (
                <ChannelVisibilityFilterButton value={channelVisibility} onToggle={handleChannelVisibilityToggle} />
              )}
              <TagFilterStrip
                workspaceId={wsId}
                value={localSearchValue}
                onChange={handleSearchChange}
                onSubmit={handleSearchSubmit}
              />
            </div>
          )}
          <SearchResults
            workspaceId={wsId}
            resourceType={resourceType}
            searchText={searchQuery || undefined}
            tags={tags.length > 0 ? tags : undefined}
            isFavorite={favoriteFilterToBoolean(isFavorite)}
            favoriteFilter={isFavorite}
            channelVisibility={channelVisibility}
            onLoadingChange={handleLoadingChange}
            showFavorites={showFavorites}
            subPath={subPath}
          />
        </div>
      </div>

      {createDialog}
      {isMobile && (onCreate || secondaryAction) && (
        <HeaderSlot>
          <div className="flex items-center gap-1">
            {secondaryAction}
            {onCreate && (
              <Button onClick={onCreate} variant="ghost" size="icon" aria-label="Create new">
                <Plus className="size-4" />
              </Button>
            )}
          </div>
        </HeaderSlot>
      )}
    </div>
  );
}
