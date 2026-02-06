import { useMutation, useQuery } from "convex/react";
import { FormEvent, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { useToast } from "../../../components/ui/use-toast";

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

  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameDiagram({ name, id: diagramId });
      toast({
        title: "Diagram renamed",
        description: `Successfully renamed diagram to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error renaming diagram",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Rename Diagram</DialogTitle>
          <DialogDescription>
            Choose a new name for your diagram.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Input
                id="name"
                placeholder="Diagram name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="col-span-4"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
} 