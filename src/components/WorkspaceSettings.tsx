import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useToast } from "./ui/use-toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useEffect } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { useParams } from "react-router-dom";

export function WorkspaceSettings() {
    const { workspaceId } = useParams()
    let id = workspaceId as Id<"workspaces">
    const workspace = useQuery(api.workspaces.get, { id});
    const updateWorkspace = useMutation(api.workspaces.update);
    const { toast } = useToast();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    useEffect(() => {
        if (workspace) {
            setName(workspace.name);
            setDescription(workspace.description || "");
        }
    }, [workspace]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await updateWorkspace({ id, name, description });
            toast({
                title: "Workspace updated",
                description: "Workspace settings have been updated successfully.",
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
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="name" className="block text-sm font-medium">Workspace Name</label>
                <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>
            <div>
                <label htmlFor="description" className="block text-sm font-medium">Description</label>
                <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full border rounded-md p-2"
                />
            </div>
            <Button type="submit">Save Changes</Button>
        </form>
    );
}