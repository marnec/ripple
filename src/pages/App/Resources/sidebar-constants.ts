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
 * Write "search" as the active tab to localStorage so ResourceListPage opens
 * on the search tab when navigated to from a sidebar header click.
 */
export function preselectSearchTab(workspaceId: string, resourceType: ResourceType) {
  const key = `ripple:search:${workspaceId}:${resourceType}`;
  localStorage.setItem(key, JSON.stringify({ tab: "search", q: "", tags: [] }));
}

/**
 * Write "favorites" as the active tab to localStorage so ResourceListPage opens
 * on the favorites tab when navigated to from an empty favorite slot click.
 */
export function preselectFavoritesTab(workspaceId: string, resourceType: ResourceType) {
  const key = `ripple:search:${workspaceId}:${resourceType}`;
  localStorage.setItem(key, JSON.stringify({ tab: "favorites", q: "", tags: [] }));
}
