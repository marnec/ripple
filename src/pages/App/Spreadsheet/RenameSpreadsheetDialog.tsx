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

  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await renameSpreadsheet({ name, id: spreadsheetId });
      toast({
        title: "Spreadsheet renamed",
        description: `Successfully renamed spreadsheet to "${name}"`,
      });
      setName("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error renaming spreadsheet",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Rename Spreadsheet</DialogTitle>
          <DialogDescription>
            Choose a new name for your spreadsheet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Input
                id="name"
                placeholder="Spreadsheet name"
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
