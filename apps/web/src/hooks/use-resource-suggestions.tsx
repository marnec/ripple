import { File, FolderKanban, PenTool, Table2 } from "lucide-react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type ResourceType = "project" | "document" | "diagram" | "spreadsheet";

type ResourceSuggestionsOptions = {
  workspaceId: Id<"workspaces"> | undefined;
  editor: any;
  /**
   * Diagrams don't insert an inline chip — picking one opens the frame picker
   * so the message carries a snapshot. Omit to leave diagrams out entirely.
   */
  onDiagramSelect?: (diagram: { id: Id<"diagrams">; name: string }) => void;
  /** Suggestions per resource group. Default 5. */
  perType?: number;
};

/** Group heading + icon per resource type, in the order the menu renders them. */
const GROUPS: { type: ResourceType; group: string; icon: React.JSX.Element }[] = [
  { type: "project", group: "Projects", icon: <FolderKanban className="h-4 w-4" /> },
  { type: "document", group: "Documents", icon: <File className="h-4 w-4" /> },
  { type: "diagram", group: "Diagrams", icon: <PenTool className="h-4 w-4" /> },
  { type: "spreadsheet", group: "Spreadsheets", icon: <Table2 className="h-4 w-4" /> },
];

/**
 * Returns a `getItems` callback for BlockNote's
 * `<SuggestionMenuController triggerCharacter="#">` that offers the workspace's
 * projects, documents, diagrams and spreadsheets.
 *
 * The picker used to client-filter four whole workspace tables that the
 * always-mounted sidebar subscription shipped down. It now asks the server per
 * keystroke instead — a point-in-time `convex.query` (no subscription) against
 * the `nodes.by_name` search index, mirroring `useEventSuggestions`.
 */
export function useResourceSuggestions({
  workspaceId,
  editor,
  onDiagramSelect,
  perType,
}: ResourceSuggestionsOptions) {
  const convex = useConvex();
  return async (query: string) => {
    if (!workspaceId) return [];
    const groups = GROUPS.filter((g) => g.type !== "diagram" || onDiagramSelect);
    const trimmed = query.trim();

    const results = await convex.query(api.nodes.suggest, {
      workspaceId,
      types: groups.map((g) => g.type),
      query: trimmed.length > 0 ? trimmed : undefined,
      perType,
    });

    return results.flatMap((r) => {
      const group = groups.find((g) => g.type === r.resourceType);
      if (!group) return [];
      return [
        {
          title: r.name,
          onItemClick: () => insert(r, editor, onDiagramSelect),
          icon: group.icon,
          group: group.group,
        },
      ];
    });
  };
}

function insert(
  r: { resourceId: string; resourceType: ResourceType; name: string },
  editor: any,
  onDiagramSelect?: (diagram: { id: Id<"diagrams">; name: string }) => void,
) {
  if (r.resourceType === "diagram") {
    onDiagramSelect?.({ id: r.resourceId as Id<"diagrams">, name: r.name });
    return;
  }
  if (r.resourceType === "project") {
    editor.insertInlineContent([
      { type: "projectReference", props: { projectId: r.resourceId } },
      " ",
    ]);
    return;
  }
  editor.insertInlineContent([
    {
      type: "resourceReference",
      props: { resourceId: r.resourceId, resourceType: r.resourceType, resourceName: r.name },
    },
    " ",
  ]);
}
