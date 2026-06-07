import { RippleSpinner } from "@/components/RippleSpinner";
import {
  SettingsLayout,
  useSettingsSection,
  type SettingsSection,
} from "@/components/SettingsLayout";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useViewer } from "../UserContext";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const SECTIONS: SettingsSection[] = [
  {
    value: "general",
    label: "General",
    icon: SlidersHorizontal,
    description: "Diagram name and tags.",
  },
  {
    value: "danger",
    label: "Delete",
    icon: Trash2,
    title: "Delete diagram",
    destructive: true,
  },
];

type DiagramSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams">;
};

function DiagramSettingsContent({
  workspaceId,
  diagramId,
}: DiagramSettingsContentProps) {
  const navigate = useNavigate();
  // Queries
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const currentUser = useViewer();

  // Mutations
  const renameDiagram = useMutation(api.diagrams.rename);
  const updateTags = useMutation(api.diagrams.updateTags);

  // Confirmed delete hook
  const { requestDelete, dialog: deleteDialog } = useConfirmedDelete("diagram", workspaceId, {
    onDeleted: () => void navigate(`/workspaces/${workspaceId}/diagrams`),
  });

  // Local state
  const [diagramName, setDiagramName] = useState<string | null>(null);
  const { active, setActive } = useSettingsSection(SECTIONS);

  if (diagram === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
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
      toast.success("Diagram updated");
      setDiagramName(null);
    } catch (error) {
      toast.error("Error updating diagram", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <>
      <MobileHeaderTitle name={diagram.name} />
      <SettingsLayout
        eyebrow="Diagram"
        sections={SECTIONS}
        active={active}
        onChange={setActive}
      >
        {active.value === "general" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="diagram-name">Diagram Name</Label>
              <Input
                id="diagram-name"
                value={displayName}
                onChange={(e) => setDiagramName(e.target.value)}
                placeholder="Enter diagram name"
              />
              {hasChanges && (
                <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <TagInput
                value={diagram.tags ?? []}
                onChange={(tags) => void updateTags({ id: diagramId, tags })}
                workspaceId={workspaceId}
                placeholder="Add tags to organize this diagram..."
              />
            </div>
          </div>
        )}

        {active.value === "danger" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the diagram and all its content. This
              cannot be undone.
            </p>
            <Button
              variant="destructive"
              onClick={() => void requestDelete(diagramId, diagram.name)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Diagram
            </Button>
            {deleteDialog}
          </div>
        )}
      </SettingsLayout>
    </>
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
