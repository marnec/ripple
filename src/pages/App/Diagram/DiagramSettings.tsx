import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type DiagramSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams">;
};

function DiagramSettingsContent({
  workspaceId,
  diagramId,
}: DiagramSettingsContentProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const renameDiagram = useMutation(api.diagrams.rename);

  // Confirmed delete hook
  const { requestDelete, dialog: deleteDialog } = useConfirmedDelete("diagram", {
    onDeleted: () => void navigate(`/workspaces/${workspaceId}/diagrams`),
  });

  // Local state
  const [diagramName, setDiagramName] = useState<string | null>(null);

  if (diagram === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (currentUser === null) {
    return <SomethingWentWrong />;
  }

  if (diagram === null) {
    return <ResourceDeleted resourceType="diagram" />;
  }

  const displayName = diagramName ?? diagram.name;
  const hasChanges = diagramName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameDiagram({ id: diagramId, name: displayName });
      toast({ title: "Diagram updated" });
      setDiagramName(null);
    } catch (error) {
      toast({
        title: "Error updating diagram",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Diagram Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="diagram-name">Diagram Name</Label>
            <Input
              id="diagram-name"
              value={displayName}
              onChange={(e) => setDiagramName(e.target.value)}
              placeholder="Enter diagram name"
            />
          </div>

          {hasChanges && (
            <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
          )}
        </div>
      </section>

      <Separator className="my-6" />

      {/* Danger Zone */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-destructive">
          Danger Zone
        </h2>
        <Button
          variant="destructive"
          onClick={() => void requestDelete(diagramId, diagram.name)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Diagram
        </Button>
        <p className="text-sm text-muted-foreground mt-2">
          This will permanently delete the diagram and all its content.
        </p>
        {deleteDialog}
      </section>
    </div>
  );
}

/* ─── Entry Point ────────────────────────────────────────────────── */

export const DiagramSettings = () => {
  const { workspaceId, diagramId } = useParams<QueryParams>();

  if (!workspaceId || !diagramId) return <SomethingWentWrong />;

  return (
    <DiagramSettingsContent
      workspaceId={workspaceId}
      diagramId={diagramId}
    />
  );
};
