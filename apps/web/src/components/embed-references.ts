import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";

/** A backlink/embed pointing at a resource, enriched with its source name. */
export type Reference = {
  _id: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
};

export const SOURCE_TYPE_LABELS: Record<
  string,
  { label: string; icon: (typeof RESOURCE_TYPE_ICONS)[string] }
> = {
  document: { label: "Document", icon: RESOURCE_TYPE_ICONS.document },
  task: { label: "Task", icon: RESOURCE_TYPE_ICONS.task },
};

/** Route to the source of a reference (document/task/diagram/spreadsheet/channel). */
export function getSourceLink(ref: Reference): string {
  if (ref.sourceType === "document") {
    return `/workspaces/${ref.workspaceId}/documents/${ref.sourceId}`;
  }
  if (ref.sourceType === "task" && ref.projectId) {
    return `/workspaces/${ref.workspaceId}/projects/${ref.projectId}/tasks/${ref.sourceId}`;
  }
  if (ref.sourceType === "diagram") {
    return `/workspaces/${ref.workspaceId}/diagrams/${ref.sourceId}`;
  }
  if (ref.sourceType === "spreadsheet") {
    return `/workspaces/${ref.workspaceId}/spreadsheets/${ref.sourceId}`;
  }
  if (ref.sourceType === "channel") {
    return `/workspaces/${ref.workspaceId}/channels/${ref.sourceId}`;
  }
  return "#";
}
