import { FavoriteButton } from "@/components/FavoriteButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAnimatedQuery } from "@/hooks/use-animated-query";
import type { FavoriteFilter } from "@/hooks/use-debounced-search";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";

type SearchResult = { _id: string; name: string; tags?: string[]; _creationTime?: number };

const SEARCH_APIS = {
  document: api.documents.search,
  diagram: api.diagrams.search,
  spreadsheet: api.spreadsheets.search,
  project: api.projects.search,
  channel: api.channels.search,
} as const;

function getEmptyMessage(resourceType: ResourceType, favoriteFilter?: FavoriteFilter): string {
  switch (favoriteFilter) {
    case "favorites":
      return `No favorite ${resourceType}s yet. Star a ${resourceType} to see it here.`;
    case "unfavorited":
      return `All ${resourceType}s are already favorited!`;
    default:
      return "No results found.";
  }
}

export type SearchResultsProps = {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
  isFavorite?: boolean;
  favoriteFilter?: FavoriteFilter;
  onLoadingChange?: (loading: boolean) => void;
  onCreate?: () => void;
  createLabel?: string;
  showFavorites?: boolean;
};

function useResourceSearch(
  resourceType: ResourceType,
  workspaceId: Id<"workspaces">,
  searchText?: string,
  tags?: string[],
  isFavorite?: boolean,
) {
  // channels.search has a simpler signature (no tags/isFavorite)
  const channelResults = useQuery(
    SEARCH_APIS.channel,
    resourceType === "channel" ? { workspaceId, searchText } : "skip",
  );

  const resourceResults = useQuery(
    resourceType !== "channel" ? SEARCH_APIS[resourceType] : SEARCH_APIS.document,
    resourceType !== "channel"
      ? { workspaceId, searchText, tags, isFavorite }
      : "skip",
  );

  return (resourceType === "channel" ? channelResults : resourceResults) as
    | SearchResult[]
    | undefined;
}

function useIsLoadingCallback(
  isLoading: boolean,
  onLoadingChange?: (loading: boolean) => void,
) {
  const prevIsLoading = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoading.current !== isLoading) {
      prevIsLoading.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);
}

export function SearchResults({
  workspaceId,
  resourceType,
  searchText,
  tags,
  isFavorite,
  favoriteFilter,
  onLoadingChange,
  onCreate,
  createLabel,
  showFavorites,
}: SearchResultsProps) {
  const results = useResourceSearch(resourceType, workspaceId, searchText, tags, isFavorite);
  const rendered = useAnimatedQuery(results);

  // Loading = query re-subscribing (undefined) while we have stale data buffered
  useIsLoadingCallback(results === undefined, onLoadingChange);

  // Still waiting for initial data
  if (rendered == null) return null;

  const Icon = RESOURCE_TYPE_ICONS[resourceType];

  if (rendered.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {getEmptyMessage(resourceType, favoriteFilter)}
        </p>
        {onCreate && (
          <Button variant="outline" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            {createLabel ?? `Create a ${resourceType}`}
          </Button>
        )}
      </div>
    );
  }

  return (
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
          <Link to={`${resource._id}`} className="flex grow flex-col">
            <CardHeader className="flex flex-row items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CardTitle className="truncate text-base">
                {resource.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between pt-0">
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
                  Created{" "}
                  {formatDistanceToNow(resource._creationTime, {
                    addSuffix: true,
                  })}
                </p>
              )}
            </CardContent>
          </Link>
          {showFavorites !== false && resourceType !== "channel" && (
            <div className="absolute right-2 top-2 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:[&:has(:focus-visible)]:opacity-100">
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
  );
}
