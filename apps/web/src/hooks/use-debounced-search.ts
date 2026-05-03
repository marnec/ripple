import { useEffect, useRef, useState } from "react";
import { buildSearchString, parseSearchInput } from "@/lib/search-utils";
import type { BrowsableResourceType as ResourceType } from "@ripple/shared/types/resources";
export type FavoriteFilter = "all" | "favorites";
export type ChannelVisibilityFilter = "all" | "public" | "private";

/** Convert a FavoriteFilter to the boolean | undefined expected by Convex search queries. */
export function favoriteFilterToBoolean(filter: FavoriteFilter): boolean | undefined {
  return filter === "favorites" ? true : undefined;
}

function getStorageKey(workspaceId: string, resourceType: ResourceType) {
  return `ripple:search:${workspaceId}:${resourceType}`;
}

function readSearchState(workspaceId: string, resourceType: ResourceType) {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId, resourceType));
    if (!raw) return { q: "", tags: [] as string[], isFavorite: "all" as FavoriteFilter, channelVisibility: "all" as ChannelVisibilityFilter };
    const parsed = JSON.parse(raw) as { q?: string; tags?: string[]; isFavorite?: boolean | FavoriteFilter; channelVisibility?: ChannelVisibilityFilter };
    // Migrate old boolean values; legacy "unfavorited" string falls through to "all".
    const fav: FavoriteFilter =
      parsed.isFavorite === true || parsed.isFavorite === "favorites" ? "favorites" : "all";
    const vis: ChannelVisibilityFilter =
      parsed.channelVisibility === "public" || parsed.channelVisibility === "private"
        ? parsed.channelVisibility
        : "all";
    return {
      q: parsed.q || "",
      tags: parsed.tags ?? [],
      isFavorite: fav,
      channelVisibility: vis,
    };
  } catch {
    return { q: "", tags: [] as string[], isFavorite: "all" as FavoriteFilter, channelVisibility: "all" as ChannelVisibilityFilter };
  }
}

function writeSearchState(
  workspaceId: string,
  resourceType: ResourceType,
  state: { q: string; tags: string[]; isFavorite: FavoriteFilter; channelVisibility: ChannelVisibilityFilter },
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
  const [channelVisibility, setChannelVisibility] = useState<ChannelVisibilityFilter>(
    resourceType === "channel" ? stored.channelVisibility : "all",
  );

  const [localSearchValue, setLocalSearchValue] = useState(
    () => buildSearchString(stored.q, stored.tags),
  );
  const [isSearchDebouncing, setIsSearchDebouncing] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistState = (q: string, t: string[], fav: FavoriteFilter, vis: ChannelVisibilityFilter = channelVisibility) => {
    writeSearchState(workspaceId, resourceType, { q, tags: t, isFavorite: fav, channelVisibility: vis });
  };

  const flushSearch = (value: string) => {
    const parsed = parseSearchInput(value);
    setSearchQuery(parsed.searchText);
    setTags(parsed.tags);
    // Backend uses precedence (search > tags > favorites). When search or tags
    // become active, clear `isFavorite` so the UI doesn't show a stale chip
    // that the server silently ignores.
    const nextFav: FavoriteFilter =
      parsed.searchText || parsed.tags.length > 0 ? "all" : isFavorite;
    if (nextFav !== isFavorite) setIsFavorite(nextFav);
    persistState(parsed.searchText, parsed.tags, nextFav);
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
    const next: FavoriteFilter = isFavorite === "all" ? "favorites" : "all";
    setIsFavorite(next);
    // Mutex with search/tags: activating a favorite filter clears them so the
    // UI matches the backend's precedence order.
    if (next !== "all") {
      setSearchQuery("");
      setTags([]);
      setLocalSearchValue("");
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setIsSearchDebouncing(false);
      persistState("", [], next);
    } else {
      persistState(searchQuery, tags, next);
    }
  };

  const handleChannelVisibilityToggle = () => {
    const cycle: ChannelVisibilityFilter[] = ["all", "public", "private"];
    const idx = cycle.indexOf(channelVisibility);
    const next = cycle[(idx + 1) % cycle.length];
    setChannelVisibility(next);
    persistState(searchQuery, tags, isFavorite, next);
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
      if (resourceType === "channel") setChannelVisibility(fresh.channelVisibility);
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
    channelVisibility,
    isSearchDebouncing,
    resetKey,
    handleSearchChange,
    handleSearchSubmit,
    handleFavoriteToggle,
    handleChannelVisibilityToggle,
  };
}
