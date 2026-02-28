import { useCallback, useEffect, useRef, useState } from "react";
import { buildSearchString, parseSearchInput } from "@/lib/search-utils";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project" | "channel";

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

export function useDebouncedSearch(
  workspaceId: string,
  resourceType: ResourceType,
  showFavorites: boolean,
) {
  const [stored] = useState(() => readSearchState(workspaceId, resourceType));
  const [searchQuery, setSearchQuery] = useState(stored.q);
  const [tags, setTags] = useState(stored.tags);
  const [isFavorite, setIsFavorite] = useState(showFavorites ? stored.isFavorite : false);

  const [localSearchValue, setLocalSearchValue] = useState(
    () => buildSearchString(stored.q, stored.tags),
  );
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
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

  const handleFavoriteToggle = useCallback(() => {
    const next = !isFavorite;
    setIsFavorite(next);
    persistState(searchQuery, tags, next);
  }, [isFavorite, persistState, searchQuery, tags]);

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
    handleSearchChange,
    handleSearchSubmit,
    handleFavoriteToggle,
  };
}
