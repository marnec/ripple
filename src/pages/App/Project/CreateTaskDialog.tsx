import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useMutation } from "convex/react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type CreateTaskDialogProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateTaskDialog({
  projectId,
  workspaceId,
  open,
  onOpenChange,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createTask = useMutation(api.tasks.create);

  const handleOpenChange = (next: boolean) => {
    if (!next) setTitle("");
    onOpenChange(next);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setIsCreating(true);
    createTask({ projectId, workspaceId, title: trimmedTitle })
      .then(() => {
        setTitle("");
        onOpenChange(false);
      })
      .catch((error) => {
        toast.error("Failed to create task", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => setIsCreating(false));
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Task</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              autoFocus
              placeholder="Task name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isCreating}
            />
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={isCreating || !title.trim()}>
                Create
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
