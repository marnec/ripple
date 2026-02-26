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
import { FileText, Folder, PenTool, Plus, Table2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
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
  onCreate?: () => void;
  createLabel?: string;
  createDialog?: React.ReactNode;
};

function getStorageKey(workspaceId: string, resourceType: ResourceType) {
  return `ripple:search:${workspaceId}:${resourceType}`;
}

function readSearchState(workspaceId: string, resourceType: ResourceType) {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId, resourceType));
    if (!raw) return { tab: "favorites", q: "", tags: [] as string[] };
    const parsed = JSON.parse(raw) as { tab?: string; q?: string; tags?: string[] };
    return {
      tab: parsed.tab || "favorites",
      q: parsed.q || "",
      tags: parsed.tags ?? [],
    };
  } catch {
    return { tab: "favorites", q: "", tags: [] as string[] };
  }
}

function writeSearchState(
  workspaceId: string,
  resourceType: ResourceType,
  state: { tab: string; q: string; tags: string[] },
) {
  localStorage.setItem(getStorageKey(workspaceId, resourceType), JSON.stringify(state));
}

export function ResourceListPage({
  resourceType,
  title,
  workspaceId,
  onCreate,
  createLabel,
  createDialog,
}: ResourceListPageProps) {
  const wsId = workspaceId as Id<"workspaces">;

  // Read initial state from localStorage once
  const [stored] = useState(() => readSearchState(workspaceId, resourceType));
  const [tab, setTab] = useState(stored.tab);
  const [searchQuery, setSearchQuery] = useState(stored.q);
  const [tags, setTags] = useState(stored.tags);

  const [localSearchValue, setLocalSearchValue] = useState(
    () => buildSearchString(stored.q, stored.tags),
  );
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(true);
  const [isFavoritesLoading, setIsFavoritesLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSearch = useCallback(
    (value: string) => {
      const parsed = parseSearchInput(value);
      setSearchQuery(parsed.searchText);
      setTags(parsed.tags);
      writeSearchState(workspaceId, resourceType, {
        tab: "search",
        q: parsed.searchText,
        tags: parsed.tags,
      });
    },
    [workspaceId, resourceType],
  );

  const handleTabChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setTab(value);
    if (value === "favorites") {
      writeSearchState(workspaceId, resourceType, { tab: "favorites", q: "", tags: [] });
      setSearchQuery("");
      setTags([]);
      setLocalSearchValue("");
    } else {
      writeSearchState(workspaceId, resourceType, { tab: value, q: searchQuery, tags });
    }
  };

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalSearchValue(value);
      setIsSearchDebouncing(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setIsSearchDebouncing(false);
        flushSearch(value);
      }, 300);
    },
    [flushSearch],
  );

  const handleSearchSubmit = useCallback(
    (parsed: { searchText: string; tags: string[] }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const value = buildSearchString(parsed.searchText, parsed.tags);
      setLocalSearchValue(value);
      setIsSearchDebouncing(false);
      flushSearch(value);
    },
    [flushSearch],
  );

  const handleSearchLoadingChange = useCallback((loading: boolean) => {
    setIsSearchLoading(loading);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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
        <Tabs value={tab} onValueChange={handleTabChange}>
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="favorites">Favorites</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
            </TabsList>
            <div
              className="transition-opacity duration-200"
              style={{
                opacity:
                  (tab === "search" && (isSearchDebouncing || isSearchLoading)) ||
                  (tab === "favorites" && isFavoritesLoading)
                    ? 1
                    : 0,
              }}
            >
              <RippleSpinner size={40} />
            </div>
          </div>
          <TabsContent value="favorites" className="mt-4">
            <FavoritesTab
              workspaceId={wsId}
              resourceType={resourceType}
              onLoadingChange={setIsFavoritesLoading}
              onCreate={onCreate}
              createLabel={createLabel}
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
                onLoadingChange={handleSearchLoadingChange}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
      {createDialog}
    </div>
  );
}

function FavoritesTab({
  workspaceId,
  resourceType,
  onLoadingChange,
  onCreate,
  createLabel,
}: {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  onLoadingChange?: (loading: boolean) => void;
  onCreate?: () => void;
  createLabel?: string;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.favorites.listByType,
    { workspaceId, resourceType },
    { initialNumItems: 20 },
  );

  const isLoading = status === "LoadingFirstPage";
  const prevLoading = useRef(isLoading);
  useEffect(() => {
    if (prevLoading.current !== isLoading) {
      prevLoading.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);

  if (isLoading) {
    return null;
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
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No favorites yet. Star a {resourceType} to pin it here.
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
    <div
      className="space-y-4"
      style={{ animation: "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((fav) => {
          const Icon = RESOURCE_ICONS[fav.resourceType];
          return (
            <Card key={fav._id} className="flex flex-col">
              <Link to={`${fav.resourceId}`} className="grow">
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

type SearchResult = { _id: string; name: string; tags?: string[] };
type CrossfadePhase = "spinner" | "content" | "content-exit" | "content-enter";
type CrossfadeState = {
  phase: CrossfadePhase;
  displayed: SearchResult[] | undefined;
  pending: SearchResult[] | undefined;
};
type CrossfadeAction =
  | { type: "RESULTS_LOADING" }
  | { type: "RESULTS_ARRIVED"; results: SearchResult[] }
  | { type: "RESULTS_UPDATED"; results: SearchResult[] }
  | { type: "EXIT_DONE" }
  | { type: "ENTER_DONE" };

function crossfadeReducer(
  state: CrossfadeState,
  action: CrossfadeAction,
): CrossfadeState {
  switch (action.type) {
    case "RESULTS_LOADING":
      if (state.phase === "content" || state.phase === "content-enter") {
        return { ...state, phase: "content-exit", pending: undefined };
      }
      return state;
    case "RESULTS_ARRIVED":
      if (state.phase === "spinner") {
        return { phase: "content-enter", displayed: action.results, pending: undefined };
      }
      if (state.phase === "content-exit") {
        return { ...state, pending: action.results };
      }
      return { ...state, displayed: action.results };
    case "RESULTS_UPDATED":
      return { ...state, displayed: action.results };
    case "EXIT_DONE":
      if (state.pending) {
        return { phase: "content-enter", displayed: state.pending, pending: undefined };
      }
      return { ...state, phase: "spinner", pending: undefined };
    case "ENTER_DONE":
      return { ...state, phase: "content" };
  }
}

function SearchResults({
  workspaceId,
  resourceType,
  searchText,
  tags,
  onLoadingChange,
}: {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
  onLoadingChange?: (loading: boolean) => void;
}) {
  const searchApi = SEARCH_APIS[resourceType];
  const results = useQuery(searchApi as any, {
    workspaceId,
    searchText,
    tags,
  });

  const [state, dispatch] = useReducer(crossfadeReducer, {
    phase: results === undefined ? "spinner" : ("content-enter" as CrossfadePhase),
    displayed: results as SearchResult[] | undefined,
    pending: undefined,
  });

  // Track results changes
  const prevResults = useRef(results);
  useEffect(() => {
    if (results === prevResults.current) return;
    const wasUndefined = prevResults.current === undefined;
    prevResults.current = results;

    if (results === undefined) {
      dispatch({ type: "RESULTS_LOADING" });
    } else if (wasUndefined || state.phase === "spinner" || state.phase === "content-exit") {
      dispatch({ type: "RESULTS_ARRIVED", results: results as SearchResult[] });
    } else {
      dispatch({ type: "RESULTS_UPDATED", results: results as SearchResult[] });
    }
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report loading state to parent
  const isLoading = state.phase === "spinner";
  const prevIsLoading = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoading.current !== isLoading) {
      prevIsLoading.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);

  // Timed phase transitions
  useEffect(() => {
    if (state.phase === "content-exit") {
      const t = setTimeout(() => dispatch({ type: "EXIT_DONE" }), 150);
      return () => clearTimeout(t);
    }
    if (state.phase === "content-enter") {
      const t = setTimeout(() => dispatch({ type: "ENTER_DONE" }), 250);
      return () => clearTimeout(t);
    }
  }, [state.phase]);

  const Icon = RESOURCE_ICONS[resourceType];

  const renderContent = (items: SearchResult[] | undefined) => {
    if (!items || items.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">No results found.</p>
      );
    }
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((resource) => (
          <Card key={resource._id} className="flex flex-col">
            <Link to={`${resource._id}`} className="grow">
              <CardHeader className="flex flex-row items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CardTitle className="truncate text-base">
                  {resource.name}
                </CardTitle>
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
  };

  switch (state.phase) {
    case "content-exit":
      return (
        <div style={{ animation: "fade-out 150ms ease forwards" }}>
          {renderContent(state.displayed)}
        </div>
      );
    case "spinner":
      return null;
    case "content-enter":
      return (
        <div
          style={{
            animation:
              "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {renderContent(state.displayed)}
        </div>
      );
    case "content":
      return renderContent(state.displayed);
  }
}
