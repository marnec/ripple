import { createContext, useContext } from "react";

type FavoriteIds = {
  document: string[];
  diagram: string[];
  spreadsheet: string[];
  project: string[];
};

export const FavoritesContext = createContext<FavoriteIds | undefined>(
  undefined,
);

/** Check if a resource is favorited based on sidebar data (optimistic, available early). */
export function useOptimisticIsFavorited(
  resourceType: "document" | "diagram" | "spreadsheet" | "project",
  resourceId: string,
): boolean | undefined {
  const favorites = useContext(FavoritesContext);
  if (!favorites) return undefined;
  return favorites[resourceType].includes(resourceId);
}
