import { createReactInlineContentSpec } from "@blocknote/react";
import { File, PenTool, Table2 } from "lucide-react";

const RESOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  document: File,
  diagram: PenTool,
  spreadsheet: Table2,
};

export const ResourceReference = createReactInlineContentSpec(
  {
    type: "resourceReference",
    propSchema: {
      resourceId: {
        default: "" as unknown as string,
      },
      resourceType: {
        default: "" as unknown as string,
      },
      resourceName: {
        default: "",
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { resourceId, resourceType, resourceName } = inlineContent.props;

      if (!resourceId) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/20 text-sm">
            #unknown-resource
          </span>
        );
      }

      const Icon = RESOURCE_ICONS[resourceType] || File;

      return (
        <span
          data-resource-id={resourceId}
          data-resource-type={resourceType}
          data-content-type="resource-reference"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-sm font-medium cursor-default"
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span className="max-w-50 truncate">{resourceName || "Resource"}</span>
        </span>
      );
    },
  }
);
