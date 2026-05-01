import { FavoriteButton } from "@/components/FavoriteButton";
import { SwipeToReveal } from "@/components/SwipeToReveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAnimatedQuery } from "@/hooks/use-animated-query";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ChannelVisibilityFilter, FavoriteFilter } from "@/hooks/use-debounced-search";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { cn } from "@/lib/utils";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { format, isThisYear } from "date-fns";
import { Globe, Lock, Star, StarOff, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import type { BrowsableResourceType as ResourceType, FavoritableResourceType as FavoritableType } from "@shared/types/resources";

type SearchResult = { _id: string; name: string; tags?: string[]; _creationTime?: number; type?: string };

const PAGE_SIZE = 20;

const SEARCH_APIS = {
  document: api.documents.search,
  diagram: api.diagrams.search,
  spreadsheet: api.spreadsheets.search,
  project: api.projects.search,
  channel: api.channels.search,
} as const;

function channelVisibilityToType(filter: ChannelVisibilityFilter): "open" | "closed" | undefined {
  if (filter === "public") return "open";
  if (filter === "private") return "closed";
  return undefined;
}

function getEmptyMessage(resourceType: ResourceType, favoriteFilter?: FavoriteFilter, channelVisibility?: ChannelVisibilityFilter): string {
  if (resourceType === "channel" && channelVisibility && channelVisibility !== "all") {
    return `No ${channelVisibility} channels found.`;
  }
  switch (favoriteFilter) {
    case "favorites":
      return `No favorite ${resourceType}s yet. Star a ${resourceType} to see it here.`;
    default:
      return "No results found.";
  }
}

function compactDate(timestamp: number): string {
  const date = new Date(timestamp);
  return isThisYear(date) ? format(date, "MMM d") : format(date, "MMM d, yyyy");
}

function ChannelTypeBadge({ type }: { type: string }) {
  const isOpen = type === "open";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {isOpen ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      <span className="hidden sm:inline">{isOpen ? "Open" : type === "dm" ? "DM" : "Closed"}</span>
    </span>
  );
}

export type ResourceView = "cards" | "list";

export type SearchResultsProps = {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
  isFavorite?: boolean;
  favoriteFilter?: FavoriteFilter;
  channelVisibility?: ChannelVisibilityFilter;
  onLoadingChange?: (loading: boolean) => void;
  showFavorites?: boolean;
  subPath?: string;
  /** Desktop layout. Mobile is always list. */
  view?: ResourceView;
};

type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

function useResourceSearch(
  resourceType: ResourceType,
  workspaceId: Id<"workspaces">,
  searchText?: string,
  tags?: string[],
  isFavorite?: boolean,
  channelType?: "open" | "closed",
): { results: SearchResult[]; status: PaginationStatus; loadMore: (n: number) => void } {
  const channelPagination = usePaginatedQuery(
    SEARCH_APIS.channel,
    resourceType === "channel" ? { workspaceId, searchText, type: channelType } : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const resourcePagination = usePaginatedQuery(
    resourceType !== "channel" ? SEARCH_APIS[resourceType] : SEARCH_APIS.document,
    resourceType !== "channel"
      ? { workspaceId, searchText, tags, isFavorite }
      : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const active = resourceType === "channel" ? channelPagination : resourcePagination;
  return {
    results: active.results as SearchResult[],
    status: active.status,
    loadMore: active.loadMore,
  };
}

function useIsLoadingCallback(
  isLoading: boolean,
  onLoadingChange?: (loading: boolean) => void,
) {
  // Sentinel `null` ensures the first effect run always reports state to the
  // parent — otherwise a query that resolves synchronously on mount would
  // leave the parent stuck on its initial `isLoading: true`.
  const prevIsLoading = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevIsLoading.current !== isLoading) {
      prevIsLoading.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);
}

// ─── List row (mobile + desktop list view) ───────────────────────────────────

type ResourceListRowProps = {
  resource: SearchResult;
  resourceType: ResourceType;
  workspaceId: Id<"workspaces">;
  subPath?: string;
  showFavorites?: boolean;
  swipeEnabled: boolean;
  isSwipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
  onSwipeStart: () => void;
};

function ResourceListRow({
  resource,
  resourceType,
  workspaceId,
  subPath,
  showFavorites,
  swipeEnabled,
  isSwipeOpen,
  onSwipeOpenChange,
  onSwipeStart,
}: ResourceListRowProps) {
  const Icon = RESOURCE_TYPE_ICONS[resourceType];
  const isChannel = resourceType === "channel";
  const canFavorite = showFavorites !== false && !isChannel;
  const favType: FavoritableType = isChannel ? "document" : resourceType;
  // Only the mobile/swipe path needs the favorite state locally — desktop
  // delegates to <FavoriteButton/>, which has its own subscription.
  const isFavorited = useQuery(
    api.favorites.isFavorited,
    canFavorite && swipeEnabled ? { resourceId: resource._id } : "skip",
  ) ?? false;
  const toggle = useMutation(api.favorites.toggle);
  const navigate = useNavigate();

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void toggle({ workspaceId, resourceType: favType, resourceId: resource._id });
    onSwipeOpenChange(false);
  };

  const handleJoinCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSwipeOpenChange(false);
    void navigate(`${resource._id}/videocall`);
  };

  const to = subPath ? `${resource._id}/${subPath}` : `${resource._id}`;
  const transitionStyle = !isChannel
    ? ({
        viewTransitionName: `--resource-${resource._id}`,
        viewTransitionClass: "resource-card",
      } as React.CSSProperties)
    : undefined;

  // Desktop list: overlay-link pattern so the FavoriteButton can sit inside
  // a clickable row without nesting a <button> inside an <a>.
  if (!swipeEnabled) {
    return (
      <div
        className={cn(
          "relative flex items-center gap-2.5 px-3 h-12 bg-card hover:bg-accent transition-colors text-sm",
          isChannel ? "rounded-none" : "rounded-lg border border-border",
        )}
        style={transitionStyle}
      >
        <Link
          to={to}
          className="absolute inset-0 z-0 rounded-[inherit]"
          aria-label={resource.name}
        />
        <Icon className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="pointer-events-none flex-1 min-w-0 truncate font-medium">
          {resource.name}
        </span>
        {isChannel && resource.type !== undefined && (
          <span className="pointer-events-none">
            <ChannelTypeBadge type={resource.type} />
          </span>
        )}
        {canFavorite && (
          <div className="relative z-10">
            <FavoriteButton
              resourceType={favType}
              resourceId={resource._id}
              workspaceId={workspaceId}
            />
          </div>
        )}
        {resource._creationTime != null && (
          <span className="pointer-events-none text-xs text-muted-foreground shrink-0">
            {compactDate(resource._creationTime)}
          </span>
        )}
      </div>
    );
  }

  // Mobile list: SwipeToReveal action + Link-wrapped row.
  return (
    <SwipeToReveal
      enabled
      open={isSwipeOpen}
      onOpenChange={onSwipeOpenChange}
      onSwipeStart={onSwipeStart}
      className={isChannel ? "rounded-none" : undefined}
      style={transitionStyle}
      action={
        isChannel ? (
          <button
            onClick={handleJoinCall}
            className="flex flex-col items-center justify-center w-full h-full gap-0.5 text-white px-1 bg-blue-500"
          >
            <Video className="h-4 w-4" />
            <span className="text-[10px] font-medium leading-tight">Join call</span>
          </button>
        ) : (
          <button
            onClick={handleToggle}
            className={cn(
              "flex flex-col items-center justify-center w-full h-full gap-0.5 text-white px-1",
              isFavorited ? "bg-rose-500" : "bg-amber-500",
            )}
          >
            {isFavorited ? (
              <StarOff className="h-4 w-4" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            <span className="text-[10px] font-medium leading-tight">
              {isFavorited ? "Unstar" : "Star"}
            </span>
          </button>
        )
      }
    >
      <Link
        to={to}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 bg-card hover:bg-accent transition-colors text-sm h-14"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 truncate font-medium">{resource.name}</span>
        {isChannel && resource.type !== undefined && (
          <ChannelTypeBadge type={resource.type} />
        )}
        {canFavorite && (
          <Star
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-colors",
              isFavorited
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30",
            )}
          />
        )}
        {resource._creationTime != null && (
          <span className="text-xs text-muted-foreground shrink-0">
            {compactDate(resource._creationTime)}
          </span>
        )}
      </Link>
    </SwipeToReveal>
  );
}

// ─── Load more footer ─────────────────────────────────────────────────────────

function LoadMoreFooter({
  status,
  onLoadMore,
}: {
  status: PaginationStatus;
  onLoadMore: () => void;
}) {
  if (status === "Exhausted" || status === "LoadingFirstPage") return null;
  const isLoading = status === "LoadingMore";
  return (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        size="sm"
        onClick={onLoadMore}
        disabled={isLoading}
      >
        {isLoading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SearchResults({
  workspaceId,
  resourceType,
  searchText,
  tags,
  isFavorite,
  favoriteFilter,
  channelVisibility,
  onLoadingChange,
  showFavorites,
  subPath,
  view = "cards",
}: SearchResultsProps) {
  const { results, status, loadMore } = useResourceSearch(
    resourceType,
    workspaceId,
    searchText,
    tags,
    isFavorite,
    channelVisibilityToType(channelVisibility ?? "all"),
  );

  // While the query resets after a filter change (LoadingFirstPage), feed
  // `undefined` to keep the previously-rendered page visible until the new
  // first page arrives — preserves the smooth fade between filter changes.
  const liveResults = status === "LoadingFirstPage" ? undefined : results;
  const rendered = useAnimatedQuery(liveResults);
  const isMobile = useIsMobile();

  // Track which row has its swipe action revealed (only one at a time)
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeAllSwipes = () => setSwipeOpenId(null);

  // Close swipe when tapping anywhere outside the list
  useEffect(() => {
    if (!swipeOpenId) return;
    const onTap = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      setSwipeOpenId(null);
    };
    document.addEventListener("click", onTap, { passive: true });
    return () => document.removeEventListener("click", onTap);
  }, [swipeOpenId]);

  // Loading = first page hasn't resolved yet (subsequent pages have their own
  // affordance via the Load more button).
  useIsLoadingCallback(status === "LoadingFirstPage", onLoadingChange);

  // Still waiting for initial data
  if (rendered == null) return null;

  const Icon = RESOURCE_TYPE_ICONS[resourceType];

  if (rendered.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {getEmptyMessage(resourceType, favoriteFilter, channelVisibility)}
        </p>
      </div>
    );
  }

  const handleLoadMore = () => loadMore(PAGE_SIZE);

  // ── List view (mobile always; desktop when view="list") ─────────────────
  // Channels: flat grouped list (no rounded per-item, divider-separated)
  // Others:   pill cards with gap between each item
  const isListView = isMobile || view === "list";
  if (isListView) {
    const isChannel = resourceType === "channel";
    return (
      <>
        <div
          ref={listRef}
          className={
            isChannel
              ? "flex flex-col overflow-hidden rounded-lg border border-border divide-y divide-border"
              : "flex flex-col gap-1.5"
          }
        >
          {rendered.map((resource) => (
            <ResourceListRow
              key={resource._id}
              resource={resource}
              resourceType={resourceType}
              workspaceId={workspaceId}
              subPath={subPath}
              showFavorites={showFavorites}
              swipeEnabled={isMobile}
              isSwipeOpen={swipeOpenId === resource._id}
              onSwipeOpenChange={(open) => setSwipeOpenId(open ? resource._id : null)}
              onSwipeStart={closeAllSwipes}
            />
          ))}
        </div>
        <LoadMoreFooter status={status} onLoadMore={handleLoadMore} />
      </>
    );
  }

  // ── Desktop: card grid with always-visible star ───────────────────────────
  return (
    <>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {rendered.map((resource) => (
        <Card
          key={resource._id}
          className="group relative flex flex-col transition-colors hover:border-foreground/20"
          style={{
            viewTransitionName: `--resource-${resource._id}`,
            viewTransitionClass: "resource-card",
          } as React.CSSProperties}
        >
          <Link
            to={subPath ? `${resource._id}/${subPath}` : `${resource._id}`}
            className="absolute inset-0 z-0"
            aria-label={resource.name}
          />
          <CardHeader className="pointer-events-none flex flex-row items-center gap-2 pr-9">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="truncate text-base">
              {resource.name}
            </CardTitle>
            {resourceType === "channel" && resource.type !== undefined && (
              <ChannelTypeBadge type={resource.type} />
            )}
          </CardHeader>
          <CardContent className="pointer-events-none flex flex-1 flex-col justify-between pt-0">
            <div className="flex flex-wrap gap-1">
              {resource.tags && resource.tags.length > 0 ? (
                resource.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary" className="invisible text-xs">
                  &nbsp;
                </Badge>
              )}
            </div>
            {resource._creationTime != null && (
              <p className="mt-3 text-xs text-muted-foreground">
                {compactDate(resource._creationTime)}
              </p>
            )}
          </CardContent>
          {showFavorites !== false && resourceType !== "channel" && (
            <div className="absolute right-2 top-2 z-10">
              <FavoriteButton
                resourceType={resourceType}
                resourceId={resource._id}
                workspaceId={workspaceId}
              />
            </div>
          )}
        </Card>
      ))}
    </div>
    <LoadMoreFooter status={status} onLoadMore={handleLoadMore} />
    </>
  );
}
