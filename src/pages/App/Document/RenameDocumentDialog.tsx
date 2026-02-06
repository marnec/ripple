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

export function RenameDocumentDialog({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: Id<"documents">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");

  const renameDocument = useMutation(api.documents.rename);

  const document = useQuery(api.documents.get, { id: documentId });

  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameDocument({ name, id: documentId });
      toast({
        title: "Document renamed",
        description: `Successfully renamed document to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error renaming document",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename document </DialogTitle>
          <DialogDescription>{document?.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new document name"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
