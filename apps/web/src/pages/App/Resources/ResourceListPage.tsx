import { ChannelVisibilityFilterButton } from "@/components/ChannelVisibilityFilterButton";
import { FavoriteFilterButton } from "@/components/FavoriteFilterButton";
import { ResourceSearchInput, TagFilterStrip } from "@/components/ResourceSearchInput";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { favoriteFilterToBoolean, useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useIsMobile } from "@/hooks/use-mobile";
import { Filter, LayoutGrid, LayoutList, Plus } from "lucide-react";
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { SearchResults, type ResourceView } from "./SearchResults";
import type { BrowsableResourceType as ResourceType } from "@ripple/shared/types/resources";

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
  const [view, setView] = useState<ResourceView>("cards");

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

  const handleViewChange = (next: ResourceView) => {
    setView(next);
  };

  // Switcher is desktop-only and always visible there, so the strip always renders on desktop.
  const showFilterStrip =
    !isMobile || showFavorites || resourceType === "channel" || tags.length > 0;

  const createButton = onCreate ? (
    <Button onClick={onCreate} size="sm">
      <Plus className="h-4 w-4 sm:mr-1.5" />
      <span className="hidden sm:inline">{createLabel ?? `New ${resourceType}`}</span>
    </Button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in">
      {/* Shared toolbar — title left, search center, actions right */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-1.5 border-b">
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
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {!isMobile && (
                  <Tabs value={view} onValueChange={(v) => handleViewChange(v as ResourceView)}>
                    <TabsList className="h-10">
                      <TabsTrigger value="cards" className="flex items-center gap-2">
                        <LayoutGrid className="h-4 w-4" />
                        Cards
                      </TabsTrigger>
                      <TabsTrigger value="list" className="flex items-center gap-2">
                        <LayoutList className="h-4 w-4" />
                        List
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                <Filter className="ml-3 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {showFavorites && (
                  <FavoriteFilterButton value={isFavorite} onToggle={handleFavoriteToggle} />
                )}
                {resourceType === "channel" && (
                  <ChannelVisibilityFilterButton
                    value={channelVisibility}
                    onToggle={handleChannelVisibilityToggle}
                  />
                )}
                {resourceType !== "project" && (
                  <TagFilterStrip
                    workspaceId={wsId}
                    value={localSearchValue}
                    onChange={handleSearchChange}
                    onSubmit={handleSearchSubmit}
                  />
                )}
              </div>
              {(isSearchDebouncing || isLoading) && (
                <div className="flex h-8 shrink-0 items-center">
                  <RippleSpinner size={32} />
                </div>
              )}
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
            view={view}
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
