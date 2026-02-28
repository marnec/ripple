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
import { useQuery } from "convex/react";
import { FileText, Folder, MessageSquare, PenTool, Plus, Table2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";

type SearchResult = { _id: string; name: string; tags?: string[] };

const RESOURCE_ICONS: Record<ResourceType, typeof FileText> = {
  document: FileText,
  diagram: PenTool,
  spreadsheet: Table2,
  project: Folder,
  channel: MessageSquare,
};

const SEARCH_APIS = {
  document: api.documents.search,
  diagram: api.diagrams.search,
  spreadsheet: api.spreadsheets.search,
  project: api.projects.search,
  channel: api.channels.search,
} as const;

export type SearchResultsProps = {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
  isFavorite?: boolean;
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

  const Icon = RESOURCE_ICONS[resourceType];

  if (rendered.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isFavorite
            ? `No favorite ${resourceType}s yet. Star a ${resourceType} to see it here.`
            : "No results found."}
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
          className="flex flex-col"
          style={{
            viewTransitionName: `--resource-${resource._id}`,
            viewTransitionClass: "resource-card",
          } as React.CSSProperties}
        >
          <Link to={`${resource._id}`} className="grow">
            <CardHeader className="flex flex-row items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CardTitle className="truncate text-base">
                {resource.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
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
            </CardContent>
          </Link>
          {showFavorites !== false && resourceType !== "channel" ? (
            <CardContent className="flex items-center justify-end pt-0">
              <FavoriteButton
                resourceType={resourceType}
                resourceId={resource._id}
                workspaceId={workspaceId}
              />
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
