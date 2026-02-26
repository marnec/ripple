import { FavoriteButton } from "@/components/FavoriteButton";
import { ResourceSearchInput } from "@/components/ResourceSearchInput";
import { buildSearchString, parseSearchInput } from "@/lib/search-utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePaginatedQuery, useQuery } from "convex/react";
import { FileText, Folder, PenTool, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project";

const RESOURCE_ICONS: Record<ResourceType, typeof FileText> = {
  document: FileText,
  diagram: PenTool,
  spreadsheet: Table2,
  project: Folder,
};

const SEARCH_APIS = {
  document: api.documents.search,
  diagram: api.diagrams.search,
  spreadsheet: api.spreadsheets.search,
  project: api.projects.search,
} as const;

type ResourceListPageProps = {
  resourceType: ResourceType;
  title: string;
  workspaceId: string;
};

export function ResourceListPage({
  resourceType,
  title,
  workspaceId,
}: ResourceListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const wsId = workspaceId as Id<"workspaces">;

  const tab = searchParams.get("tab") || "favorites";
  const searchQuery = searchParams.get("q") || "";
  const tagsParam = searchParams.get("tags") || "";
  const tags = useMemo(
    () => (tagsParam ? tagsParam.split(",").filter(Boolean) : []),
    [tagsParam],
  );

  const searchValueFromUrl = useMemo(
    () => buildSearchString(searchQuery, tags),
    [searchQuery, tags],
  );

  // Local input state for responsive typing; URL params are debounced
  const [localSearchValue, setLocalSearchValue] = useState(searchValueFromUrl);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when URL params change externally (e.g. navigating from sidebar search)
  useEffect(() => {
    setLocalSearchValue(searchValueFromUrl);
  }, [searchValueFromUrl]);

  const flushToUrl = useCallback(
    (value: string) => {
      const parsed = parseSearchInput(value);
      const params = new URLSearchParams();
      params.set("tab", "search");
      if (parsed.searchText) params.set("q", parsed.searchText);
      if (parsed.tags.length > 0) params.set("tags", parsed.tags.join(","));
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const handleTabChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value === "favorites") {
      setSearchParams({}, { replace: true });
    } else {
      const params = new URLSearchParams(searchParams);
      params.set("tab", value);
      setSearchParams(params, { replace: true });
    }
  };

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => flushToUrl(value), 300);
    },
    [flushToUrl],
  );

  const handleSearchSubmit = useCallback(
    (parsed: { searchText: string; tags: string[] }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const value = buildSearchString(parsed.searchText, parsed.tags);
      setLocalSearchValue(value);
      flushToUrl(value);
    },
    [flushToUrl],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="container mx-auto p-4">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {title} in this workspace.
          </p>
        </div>
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="favorites">Favorites</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
          </TabsList>
          <TabsContent value="favorites" className="mt-4">
            <FavoritesTab
              workspaceId={wsId}
              resourceType={resourceType}
            />
          </TabsContent>
          <TabsContent value="search" className="mt-4">
            <div className="space-y-4">
              <ResourceSearchInput
                workspaceId={wsId}
                value={localSearchValue}
                onChange={handleSearchChange}
                onSubmit={handleSearchSubmit}
                placeholder={`Search ${title.toLowerCase()}... #tag to filter`}
              />
              <SearchResults
                workspaceId={wsId}
                resourceType={resourceType}
                searchText={searchQuery || undefined}
                tags={tags.length > 0 ? tags : undefined}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function FavoritesTab({
  workspaceId,
  resourceType,
}: {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.favorites.listByType,
    { workspaceId, resourceType },
    { initialNumItems: 20 },
  );

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex justify-center py-12">
        <RippleSpinner size={48} />
      </div>
    );
  }

  // Filter out nulls (deleted resources)
  const items = results.filter((r: unknown) => r !== null) as Array<{
    _id: string;
    resourceId: string;
    name: string;
    resourceType: ResourceType;
    favoritedAt: number;
  }>;

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No favorites yet. Star a {resourceType} to pin it here.
      </p>
    );
  }



  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((fav) => {
          const Icon = RESOURCE_ICONS[fav.resourceType];
          return (
            <Card key={fav._id} className="flex flex-col">
              <Link to={`${fav.resourceId}`} className="flex-grow">
                <CardHeader className="flex flex-row items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <CardTitle className="truncate text-base">{fav.name}</CardTitle>
                </CardHeader>
              </Link>
              <CardContent className="flex items-center justify-end pt-0">
                <FavoriteButton
                  resourceType={resourceType}
                  resourceId={fav.resourceId}
                  workspaceId={workspaceId}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => loadMore(20)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function SearchResults({
  workspaceId,
  resourceType,
  searchText,
  tags,
}: {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
}) {
  const searchApi = SEARCH_APIS[resourceType];
  const results = useQuery(searchApi as any, {
    workspaceId,
    searchText,
    tags,
  });

  if (results === undefined) {
    return (
      <div className="flex justify-center py-12">
        <RippleSpinner size={48} />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No results found.
      </p>
    );
  }


  const Icon = RESOURCE_ICONS[resourceType];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {results.map((resource: { _id: string; name: string; tags?: string[] }) => (
        <Card key={resource._id} className="flex flex-col">
          <Link to={`${resource._id}`} className="flex-grow">
            <CardHeader className="flex flex-row items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CardTitle className="truncate text-base">{resource.name}</CardTitle>
            </CardHeader>
            {resource.tags && resource.tags.length > 0 && (
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {resource.tags.map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            )}
          </Link>
          <CardContent className="flex items-center justify-end pt-0">
            <FavoriteButton
              resourceType={resourceType}
              resourceId={resource._id}
              workspaceId={workspaceId}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
