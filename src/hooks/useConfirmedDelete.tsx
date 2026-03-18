import { DeleteWarningDialog } from "@/components/DeleteWarningDialog";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

type DeleteResult = {
  status: "deleted" | "has_references";
  references?: Array<{
    _id: string;
    sourceType: string;
    sourceId: string;
    sourceName: string;
    edgeType: string;
    workspaceId: string;
    projectId?: string;
  }>;
};

type ResourceConfig = {
  type: "diagram";
  mutation: typeof api.diagrams.remove;
} | {
  type: "spreadsheet";
  mutation: typeof api.spreadsheets.remove;
};

const RESOURCE_CONFIGS = {
  diagram: { type: "diagram" as const, mutation: api.diagrams.remove },
  spreadsheet: { type: "spreadsheet" as const, mutation: api.spreadsheets.remove },
} satisfies Record<string, ResourceConfig>;

type PendingDelete = {
  id: string;
  name: string;
  references: DeleteResult["references"];
};

export function useConfirmedDelete(
  resourceType: "diagram" | "spreadsheet",
  options?: { onDeleted?: () => void },
) {
  const config = RESOURCE_CONFIGS[resourceType];
  const deleteMutation = useMutation(config.mutation);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const requestDelete = async (id: Id<"diagrams"> | Id<"spreadsheets">, name: string) => {
    try {
      const result = (await deleteMutation({ id: id as any })) as DeleteResult;

      if (result?.status === "has_references") {
        setPending({ id, name, references: result.references });
      } else {
        toast.success(`${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} deleted`);
        options?.onDeleted?.();
      }
    } catch (error) {
      toast.error(`Error deleting ${resourceType}`, {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const confirmDelete = async () => {
    if (!pending) return;
    try {
      await deleteMutation({ id: pending.id as any, force: true });
      toast.success(`${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} deleted`);
      setPending(null);
      options?.onDeleted?.();
    } catch (error) {
      toast.error(`Error deleting ${resourceType}`, {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const dialog = pending ? (
    <DeleteWarningDialog
      open={true}
      onOpenChange={(open) => { if (!open) setPending(null); }}
      onConfirm={() => void confirmDelete()}
      resourceId={pending.id}
      resourceType={resourceType}
      resourceName={pending.name}
      preloadedReferences={pending.references}
    />
  ) : null;

  return { requestDelete, dialog };
}
