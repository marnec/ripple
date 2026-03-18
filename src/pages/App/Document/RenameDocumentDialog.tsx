import { useMutation, useQuery } from "convex/react";
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameDocument({ name, id: documentId });
      toast.success("Document renamed", {
        description: `Successfully renamed document to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Error renaming document", {
        description: (error as Error).message,
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Rename document </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{document?.name}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ResponsiveDialogBody className="space-y-4">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new document name"
              required
            />
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="submit" disabled={!name}>
              Rename
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
