import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Textarea } from "../../../components/ui/textarea";

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createWorkspace = useMutation(api.workspaces.create);
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createWorkspace({ name, description });
      toast.success("Workspace created", {
        description: `Successfully created workspace "${name}"`,
      });
      setName("");
      setDescription("");
      onOpenChange(false);
    } catch {
      toast.error("Error creating workspace", {
        description: "Please try again later",
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create New Workspace</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Create a new workspace to start chatting with your team
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter workspace name"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Enter workspace description (optional)"
                rows={3}
              />
            </div>
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={!name}>
                Create Workspace
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
