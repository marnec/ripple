/**
 * Max number of favorite slots reserved per resource group in the sidebar.
 * Empty slots are rendered as placeholders when fewer favorites exist.
 */
export const MAX_SIDEBAR_FAVORITES = 3;

/**
 * Height of a single sidebar sub-item row (matches SidebarMenuSubButton h-7 = 1.75rem).
 * Used to reserve vertical space for empty favorite slots.
 */
export const SIDEBAR_ROW_HEIGHT_REM = 1.75;

export type ResourceType = "document" | "diagram" | "spreadsheet" | "project";

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
  localStorage.setItem(key, JSON.stringify({ q: "", tags: [], isFavorite: false }));
}

/**
 * Pre-set the isFavorite filter so ResourceListPage opens filtered to favorites
 * when navigated to from an empty favorite slot click.
 */
export function preselectFavoriteFilter(workspaceId: string, resourceType: ResourceType) {
  const key = `ripple:search:${workspaceId}:${resourceType}`;
  localStorage.setItem(key, JSON.stringify({ q: "", tags: [], isFavorite: true }));
}
