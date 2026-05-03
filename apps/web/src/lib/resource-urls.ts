export function getResourceUrl(
  workspaceId: string,
  resourceType: string,
  resourceId: string,
): string {
  const base = `/workspaces/${workspaceId}`;
  switch (resourceType) {
    case "channel":
      return `${base}/channels/${resourceId}`;
    case "document":
      return `${base}/documents/${resourceId}`;
    case "diagram":
      return `${base}/diagrams/${resourceId}`;
    case "spreadsheet":
      return `${base}/spreadsheets/${resourceId}`;
    case "project":
      return `${base}/projects/${resourceId}/tasks`;
    default:
      return base;
  }
}
