import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type SpreadsheetSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets">;
};

function SpreadsheetSettingsContent({
  workspaceId,
  spreadsheetId,
}: SpreadsheetSettingsContentProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const renameSpreadsheet = useMutation(api.spreadsheets.rename);
  const deleteSpreadsheet = useMutation(api.spreadsheets.remove);

  // Local state
  const [spreadsheetName, setSpreadsheetName] = useState<string | null>(null);

  if (spreadsheet === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (spreadsheet === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const displayName = spreadsheetName ?? spreadsheet.name;
  const hasChanges = spreadsheetName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameSpreadsheet({ id: spreadsheetId, name: displayName });
      toast({ title: "Spreadsheet updated" });
      setSpreadsheetName(null);
    } catch (error) {
      toast({
        title: "Error updating spreadsheet",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSpreadsheet = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this spreadsheet? All content will be permanently lost.",
      )
    ) {
      return;
    }
    try {
      await deleteSpreadsheet({ id: spreadsheetId });
      toast({ title: "Spreadsheet deleted" });
      void navigate(`/workspaces/${workspaceId}/spreadsheets`);
    } catch (error) {
      toast({
        title: "Error deleting spreadsheet",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Spreadsheet Settings</h1>

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

      <Separator className="my-6" />

      {/* Danger Zone */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-destructive">
          Danger Zone
        </h2>
        <Button
          variant="destructive"
          onClick={() => void handleDeleteSpreadsheet()}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Spreadsheet
        </Button>
        <p className="text-sm text-muted-foreground mt-2">
          This will permanently delete the spreadsheet and all its content.
        </p>
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
