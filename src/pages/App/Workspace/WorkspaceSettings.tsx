import { useQuery, useMutation } from "convex/react";
import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { useToast } from "../../../components/ui/use-toast";
import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";

export function WorkspaceSettings() {
    const { workspaceId } = useParams()
    const id = workspaceId as Id<"workspaces">
    const workspace = useQuery(api.workspaces.get, { id});
    const updateWorkspace = useMutation(api.workspaces.update);
    const { toast } = useToast();
    const [nameOverride, setNameOverride] = useState<string | null>(null);
    const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);

    const name = nameOverride ?? workspace?.name ?? "";
    const description = descriptionOverride ?? workspace?.description ?? "";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await updateWorkspace({ id, name, description });
            toast({
                title: "Workspace updated",
                description: "Workspace settings have been updated successfully.",
                variant: 'default'
            });
        } catch (error) {
            toast({
                title: "Error updating workspace",
                description: error instanceof Error ? error.message : "Please try again later.",
                variant: "destructive",
            });
        }
    };

    return (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 w-full p-4">
            <div>
                <label htmlFor="name" className="block text-sm font-medium">Workspace Name</label>
                <Input
                    id="name"
                    value={name}
                    onChange={(e) => setNameOverride(e.target.value)}
                    required
                />
            </div>
            <div>
                <label htmlFor="description" className="block text-sm font-medium">Description</label>
                <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescriptionOverride(e.target.value)}
                    rows={3}
                />
            </div>
            <Button type="submit">Save Changes</Button>
        </form>
    );
}