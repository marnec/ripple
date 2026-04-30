import { RippleSpinner } from "@/components/RippleSpinner";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useViewer } from "../UserContext";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

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
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <MobileHeaderTitle name={spreadsheet.name} />
      <h1 className="hidden md:block text-2xl font-bold mb-6">Spreadsheet Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="spreadsheet-name">Spreadsheet Name</Label>
            <Input
              id="spreadsheet-name"
              value={displayName}
              onChange={(e) => setSpreadsheetName(e.target.value)}
              placeholder="Enter spreadsheet name"
            />
          </div>

          {hasChanges && (
            <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
          )}
        </div>
      </section>

      {/* Tags Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Tags</h2>
        <TagInput
          value={spreadsheet.tags ?? []}
          onChange={(tags) => void updateTags({ id: spreadsheetId, tags })}
          workspaceId={workspaceId}
          placeholder="Add tags to organize this spreadsheet..."
        />
      </section>

      <Separator className="my-6" />

      {/* Danger Zone */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-destructive">
          Danger Zone
        </h2>
        <Button
          variant="destructive"
          onClick={() => void requestDelete(spreadsheetId, spreadsheet.name)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Spreadsheet
        </Button>
        <p className="text-sm text-muted-foreground mt-2">
          This will permanently delete the spreadsheet and all its content.
        </p>
        {deleteDialog}
      </section>
    </div>
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
