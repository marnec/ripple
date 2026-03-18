import { useEffect, useRef, useState } from "react";
import { buildSearchString, parseSearchInput } from "@/lib/search-utils";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";
export type FavoriteFilter = "all" | "favorites" | "unfavorited";

/** Convert a FavoriteFilter to the boolean | undefined expected by Convex search queries. */
export function favoriteFilterToBoolean(filter: FavoriteFilter): boolean | undefined {
  if (filter === "favorites") return true;
  if (filter === "unfavorited") return false;
  return undefined;
}

function getStorageKey(workspaceId: string, resourceType: ResourceType) {
  return `ripple:search:${workspaceId}:${resourceType}`;
}

function readSearchState(workspaceId: string, resourceType: ResourceType) {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId, resourceType));
    if (!raw) return { q: "", tags: [] as string[], isFavorite: "all" as FavoriteFilter };
    const parsed = JSON.parse(raw) as { q?: string; tags?: string[]; isFavorite?: boolean | FavoriteFilter };
    // Migrate old boolean values
    let fav: FavoriteFilter = "all";
    if (parsed.isFavorite === true || parsed.isFavorite === "favorites") fav = "favorites";
    else if (parsed.isFavorite === "unfavorited") fav = "unfavorited";
    return {
      q: parsed.q || "",
      tags: parsed.tags ?? [],
      isFavorite: fav,
    };
  } catch {
    return { q: "", tags: [] as string[], isFavorite: "all" as FavoriteFilter };
  }
}

function writeSearchState(
  workspaceId: string,
  resourceType: ResourceType,
  state: { q: string; tags: string[]; isFavorite: FavoriteFilter },
) {
  localStorage.setItem(getStorageKey(workspaceId, resourceType), JSON.stringify(state));
}

export function useDebouncedSearch(
  workspaceId: string,
  resourceType: ResourceType,
  showFavorites: boolean,
) {
  const [stored] = useState(() => readSearchState(workspaceId, resourceType));
  const [searchQuery, setSearchQuery] = useState(stored.q);
  const [tags, setTags] = useState(stored.tags);
  const [isFavorite, setIsFavorite] = useState<FavoriteFilter>(showFavorites ? stored.isFavorite : "all");

  const [localSearchValue, setLocalSearchValue] = useState(
    () => buildSearchString(stored.q, stored.tags),
  );
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistState = (q: string, t: string[], fav: FavoriteFilter) => {
    writeSearchState(workspaceId, resourceType, { q, tags: t, isFavorite: fav });
  };

  const flushSearch = (value: string) => {
    const parsed = parseSearchInput(value);
    setSearchQuery(parsed.searchText);
    setTags(parsed.tags);
    persistState(parsed.searchText, parsed.tags, isFavorite);
  };

  const handleSearchChange = (value: string) => {
    setLocalSearchValue(value);
    setIsSearchDebouncing(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setIsSearchDebouncing(false);
      flushSearch(value);
    }, 300);
  };

  const handleSearchSubmit = (parsed: { searchText: string; tags: string[] }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = buildSearchString(parsed.searchText, parsed.tags);
    setLocalSearchValue(value);
    setIsSearchDebouncing(false);
    flushSearch(value);
  };

  const handleFavoriteToggle = () => {
    const cycle: FavoriteFilter[] = ["all", "favorites", "unfavorited"];
    const idx = cycle.indexOf(isFavorite);
    const next = cycle[(idx + 1) % cycle.length];
    setIsFavorite(next);
    persistState(searchQuery, tags, next);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { workspaceId: eid, resourceType: ert } = (e as CustomEvent).detail as { workspaceId: string; resourceType: string };
      if (eid !== workspaceId || ert !== resourceType) return;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      const fresh = readSearchState(workspaceId, resourceType);
      setSearchQuery(fresh.q);
      setTags(fresh.tags);
      setLocalSearchValue(buildSearchString(fresh.q, fresh.tags));
      setIsSearchDebouncing(false);
      if (showFavorites) setIsFavorite(fresh.isFavorite);
      setResetKey((k) => k + 1);
    };
    window.addEventListener("ripple:search-preselect", handler);
    return () => window.removeEventListener("ripple:search-preselect", handler);
  }, [workspaceId, resourceType, showFavorites]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    localSearchValue,
    searchQuery,
    tags,
    isFavorite,
    isSearchDebouncing,
    resetKey,
    handleSearchChange,
    handleSearchSubmit,
    handleFavoriteToggle,
  };
}
