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
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { FileText, Folder, MessageSquare, PenTool, Plus, Star, Table2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";

const RESOURCE_ICONS: Record<ResourceType, typeof FileText> = {
  document: FileText,
  diagram: PenTool,
  spreadsheet: Table2,
  project: Folder,
  channel: MessageSquare,
};

const SEARCH_APIS: Record<ResourceType, ReturnType<typeof makeFunctionReference<"query">>> = {
  document: makeFunctionReference<"query">("documents:search"),
  diagram: makeFunctionReference<"query">("diagrams:search"),
  spreadsheet: makeFunctionReference<"query">("spreadsheets:search"),
  project: makeFunctionReference<"query">("projects:search"),
  channel: makeFunctionReference<"query">("channels:search"),
};

type ResourceListPageProps = {
  resourceType: ResourceType;
  title: string;
  workspaceId: string;
  onCreate?: () => void;
  createLabel?: string;
  createDialog?: React.ReactNode;
  showFavorites?: boolean;
};

function getStorageKey(workspaceId: string, resourceType: ResourceType) {
  return `ripple:search:${workspaceId}:${resourceType}`;
}

function readSearchState(workspaceId: string, resourceType: ResourceType) {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId, resourceType));
    if (!raw) return { q: "", tags: [] as string[], isFavorite: false };
    const parsed = JSON.parse(raw) as { q?: string; tags?: string[]; isFavorite?: boolean };
    return {
      q: parsed.q || "",
      tags: parsed.tags ?? [],
      isFavorite: parsed.isFavorite ?? false,
    };
  } catch {
    return { q: "", tags: [] as string[], isFavorite: false };
  }
}

function writeSearchState(
  workspaceId: string,
  resourceType: ResourceType,
  state: { q: string; tags: string[]; isFavorite: boolean },
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
  showFavorites = true,
}: ResourceListPageProps) {
  const wsId = workspaceId as Id<"workspaces">;

  const [stored] = useState(() => readSearchState(workspaceId, resourceType));
  const [searchQuery, setSearchQuery] = useState(stored.q);
  const [tags, setTags] = useState(stored.tags);
  const [isFavorite, setIsFavorite] = useState(showFavorites ? stored.isFavorite : false);

  const [localSearchValue, setLocalSearchValue] = useState(
    () => buildSearchString(stored.q, stored.tags),
  );
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistState = useCallback(
    (q: string, t: string[], fav: boolean) => {
      writeSearchState(workspaceId, resourceType, { q, tags: t, isFavorite: fav });
    },
    [workspaceId, resourceType],
  );

  const flushSearch = useCallback(
    (value: string) => {
      const parsed = parseSearchInput(value);
      setSearchQuery(parsed.searchText);
      setTags(parsed.tags);
      persistState(parsed.searchText, parsed.tags, isFavorite);
    },
    [persistState, isFavorite],
  );

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

  const handleFavoriteToggle = () => {
    const next = !isFavorite;
    setIsFavorite(next);
    persistState(searchQuery, tags, next);
  };

  const handleLoadingChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

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
  isFavorite,
  onLoadingChange,
  onCreate,
  createLabel,
  showFavorites,
}: {
  workspaceId: Id<"workspaces">;
  resourceType: ResourceType;
  searchText?: string;
  tags?: string[];
  isFavorite?: boolean;
  onLoadingChange?: (loading: boolean) => void;
  onCreate?: () => void;
  createLabel?: string;
  showFavorites?: boolean;
}) {
  const searchApi = SEARCH_APIS[resourceType];
  const results = useQuery(searchApi, {
    workspaceId,
    searchText,
    tags,
    isFavorite,
  });

  const [state, dispatch] = useReducer(crossfadeReducer, {
    phase: results === undefined ? "spinner" : ("content-enter" as CrossfadePhase),
    displayed: results as SearchResult[] | undefined,
    pending: undefined,
  });

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

  const isLoading = state.phase === "spinner";
  const prevIsLoading = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoading.current !== isLoading) {
      prevIsLoading.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);

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
            {showFavorites !== false && resourceType !== "channel" && (
              <CardContent className="flex items-center justify-end pt-0">
                <FavoriteButton
                  resourceType={resourceType}
                  resourceId={resource._id}
                  workspaceId={workspaceId}
                />
              </CardContent>
            )}
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
