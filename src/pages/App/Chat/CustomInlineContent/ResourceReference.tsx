import { createReactInlineContentSpec } from "@blocknote/react";
import { File } from "lucide-react";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";

const RESOURCE_ICONS = RESOURCE_TYPE_ICONS;

export const ResourceReference = createReactInlineContentSpec(
  {
    type: "resourceReference",
    propSchema: {
      resourceId: {
        default: "",
      },
      resourceType: {
        default: "",
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
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-sm font-medium cursor-default align-middle"
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span className="max-w-50 truncate">{resourceName || "Resource"}</span>
        </span>
      );
    },
  }
);
