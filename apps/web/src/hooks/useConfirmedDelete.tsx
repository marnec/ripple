import { DeleteWarningDialog } from "@/components/DeleteWarningDialog";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

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

type DeleteMutationFn = (args: { id: any; force?: boolean }) => Promise<DeleteResult>;

async function executeDelete(
  deleteMutation: DeleteMutationFn,
  id: Id<"diagrams"> | Id<"spreadsheets">,
  resourceType: "diagram" | "spreadsheet",
  name: string,
  setPending: (v: PendingDelete | null) => void,
  onDeleted?: () => void,
) {
  try {
    const result = await deleteMutation({ id: id as any });
    if (result?.status === "has_references") {
      setPending({ id, name, references: result.references });
    } else {
      toast.success(`${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} deleted`);
      onDeleted?.();
    }
  } catch (error) {
    toast.error(`Error deleting ${resourceType}`, {
      description: error instanceof Error ? error.message : "Please try again",
    });
  }
}

async function executeForceDelete(
  deleteMutation: DeleteMutationFn,
  pending: PendingDelete,
  resourceType: "diagram" | "spreadsheet",
  setPending: (v: PendingDelete | null) => void,
  onDeleted?: () => void,
) {
  try {
    await deleteMutation({ id: pending.id as any, force: true });
    toast.success(`${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} deleted`);
    setPending(null);
    onDeleted?.();
  } catch (error) {
    toast.error(`Error deleting ${resourceType}`, {
      description: error instanceof Error ? error.message : "Please try again",
    });
  }
}

export function useConfirmedDelete(
  resourceType: "diagram" | "spreadsheet",
  workspaceId: Id<"workspaces">,
  options?: { onDeleted?: () => void },
) {
  const config = RESOURCE_CONFIGS[resourceType];
  const deleteMutation = useMutation(config.mutation) as unknown as DeleteMutationFn;
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const requestDelete = (id: Id<"diagrams"> | Id<"spreadsheets">, name: string) =>
    executeDelete(deleteMutation, id, resourceType, name, setPending, options?.onDeleted);

  const confirmDelete = () => {
    if (!pending) return;
    return executeForceDelete(deleteMutation, pending, resourceType, setPending, options?.onDeleted);
  };

  const dialog = pending ? (
    <DeleteWarningDialog
      open={true}
      onOpenChange={(open) => { if (!open) setPending(null); }}
      onConfirm={() => void confirmDelete()}
      resourceId={pending.id}
      workspaceId={workspaceId}
      resourceType={resourceType}
      resourceName={pending.name}
      preloadedReferences={pending.references}
    />
  ) : null;

  return { requestDelete, dialog };
}
