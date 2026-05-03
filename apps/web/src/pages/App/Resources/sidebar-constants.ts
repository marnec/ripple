export const SIDEBAR_ELEMENT_FADEIN_DELAY = 25;

import type { FavoritableResourceType as ResourceType } from "@ripple/shared/types/resources";
export type { FavoritableResourceType as ResourceType } from "@ripple/shared/types/resources";

/**
 * Route segments for each resource type.
 */
export const RESOURCE_ROUTES: Record<ResourceType, string> = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  project: "projects",
};

/**
 * Clear search state so ResourceListPage opens fresh when navigated to
 * from a sidebar header click.
 */
export function preselectSearchTab(workspaceId: string, resourceType: ResourceType) {
  const key = `ripple:search:${workspaceId}:${resourceType}`;
  localStorage.setItem(key, JSON.stringify({ q: "", tags: [], isFavorite: "all" }));
}
