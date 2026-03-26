import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { FormEvent, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../../components/ui/responsive-dialog";
import { Input } from "../../../components/ui/input";
import { toast } from "sonner";

export function RenameDiagramDialog({
  diagramId,
  open,
  onOpenChange,
}: {
  diagramId: Id<"diagrams">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename?: (id: Id<"diagrams">, name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");

  const renameDiagram = useMutation(api.diagrams.rename);
  useQuery(api.diagrams.get, { id: diagramId });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameDiagram({ name, id: diagramId });
      toast.success("Diagram renamed", {
        description: `Successfully renamed diagram to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Error renaming diagram", {
        description: (error as Error).message,
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Rename Diagram</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Choose a new name for your diagram.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <Input
              id="name"
              placeholder="Diagram name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Rename
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
} 