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
    description: "Spreadsheet name and tags.",
  },
  {
    value: "danger",
    label: "Delete",
    icon: Trash2,
    title: "Delete spreadsheet",
    destructive: true,
  },
];

type SpreadsheetSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets">;
};

function SpreadsheetSettingsContent({
  workspaceId,
  spreadsheetId,
}: SpreadsheetSettingsContentProps) {
  const navigate = useNavigate();
  // Queries
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const currentUser = useViewer();

  // Mutations
  const renameSpreadsheet = useMutation(api.spreadsheets.rename);
  const updateTags = useMutation(api.spreadsheets.updateTags);

  // Confirmed delete hook
  const { requestDelete, dialog: deleteDialog } = useConfirmedDelete("spreadsheet", workspaceId, {
    onDeleted: () => void navigate(`/workspaces/${workspaceId}/spreadsheets`),
  });

  // Local state
  const [spreadsheetName, setSpreadsheetName] = useState<string | null>(null);
  const { active, setActive } = useSettingsSection(SECTIONS);

  if (spreadsheet === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (currentUser === null) {
    return <SomethingWentWrong />;
  }

  if (spreadsheet === null) {
    return <ResourceDeleted resourceType="spreadsheet" />;
  }

  const displayName = spreadsheetName ?? spreadsheet.name;
  const hasChanges = spreadsheetName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameSpreadsheet({ id: spreadsheetId, name: displayName });
      toast.success("Spreadsheet updated");
      setSpreadsheetName(null);
    } catch (error) {
      toast.error("Error updating spreadsheet", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <>
      <MobileHeaderTitle name={spreadsheet.name} />
      <SettingsLayout
        eyebrow="Spreadsheet"
        sections={SECTIONS}
        active={active}
        onChange={setActive}
      >
        {active.value === "general" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="spreadsheet-name">Spreadsheet Name</Label>
              <Input
                id="spreadsheet-name"
                value={displayName}
                onChange={(e) => setSpreadsheetName(e.target.value)}
                placeholder="Enter spreadsheet name"
              />
              {hasChanges && (
                <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <TagInput
                value={spreadsheet.tags ?? []}
                onChange={(tags) => void updateTags({ id: spreadsheetId, tags })}
                workspaceId={workspaceId}
                placeholder="Add tags to organize this spreadsheet..."
              />
            </div>
          </div>
        )}

        {active.value === "danger" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the spreadsheet and all its content.
              This cannot be undone.
            </p>
            <Button
              variant="destructive"
              onClick={() => void requestDelete(spreadsheetId, spreadsheet.name)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Spreadsheet
            </Button>
            {deleteDialog}
          </div>
        )}
      </SettingsLayout>
    </>
  );
}

/* ─── Entry Point ────────────────────────────────────────────────── */

export const SpreadsheetSettings = () => {
  const { workspaceId, spreadsheetId } = useParams<QueryParams>();

  if (!workspaceId || !spreadsheetId) return <SomethingWentWrong />;

  return (
    <SpreadsheetSettingsContent
      workspaceId={workspaceId}
      spreadsheetId={spreadsheetId}
    />
  );
};
