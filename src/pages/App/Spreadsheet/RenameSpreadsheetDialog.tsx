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

export function RenameSpreadsheetDialog({
  spreadsheetId,
  open,
  onOpenChange,
}: {
  spreadsheetId: Id<"spreadsheets">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");

  const renameSpreadsheet = useMutation(api.spreadsheets.rename);
  useQuery(api.spreadsheets.get, { id: spreadsheetId });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameSpreadsheet({ name, id: spreadsheetId });
      toast.success("Spreadsheet renamed", {
        description: `Successfully renamed spreadsheet to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Error renaming spreadsheet", {
        description: (error as Error).message,
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Rename Spreadsheet</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Choose a new name for your spreadsheet.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <Input
              id="name"
              placeholder="Spreadsheet name"
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
