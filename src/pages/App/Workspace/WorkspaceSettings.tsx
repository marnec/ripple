import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export function WorkspaceSettings() {
  const { workspaceId } = useParams();
  const id = workspaceId as Id<"workspaces">;
  const workspace = useQuery(api.workspaces.get, { id });
  const updateWorkspace = useMutation(api.workspaces.update);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);

  if (workspace === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (workspace === null) {
    return <SomethingWentWrong />;
  }

  const name = nameOverride ?? workspace.name;
  const description = descriptionOverride ?? workspace.description ?? "";
  const hasChanges = nameOverride !== null || descriptionOverride !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateWorkspace({ id, name, description });
      toast.success("Workspace updated");
      setNameOverride(null);
      setDescriptionOverride(null);
    } catch (error) {
      toast.error("Error updating workspace", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Workspace Settings</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <Label htmlFor="workspace-name">Workspace Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="Enter workspace name"
              required
            />
          </div>
          <div>
            <Label htmlFor="workspace-description">Description</Label>
            <Textarea
              id="workspace-description"
              value={description}
              onChange={(e) => setDescriptionOverride(e.target.value)}
              placeholder="Enter workspace description"
              rows={3}
            />
          </div>
          {hasChanges && (
            <Button type="submit">Save Changes</Button>
          )}
        </form>
      </section>
    </div>
  );
}
