import { FormEvent, useState } from "react";
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
import {
  isValidCellRef,
  exceedsMaxCells,
  normalizeCellRef,
} from "@shared/cellRef";

interface CellRefDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spreadsheetName: string;
  onInsert: (cellRef: string | null) => void;
}

export function CellRefDialog({
  open,
  onOpenChange,
  spreadsheetName,
  onInsert,
}: CellRefDialogProps) {
  const [cellRef, setCellRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleInsert();
  };

  const handleInsert = () => {
    const trimmed = cellRef.trim();

    if (trimmed === "") {
      // Insert as plain spreadsheet link
      onInsert(null);
      reset();
      return;
    }

    const normalized = normalizeCellRef(trimmed);

    if (!isValidCellRef(normalized)) {
      setError("Invalid cell reference. Use A1 for a cell or A1:C3 for a range.");
      return;
    }

    if (exceedsMaxCells(normalized)) {
      setError("Range too large. Maximum 100 cells (e.g., 10\u00D710).");
      return;
    }

    onInsert(normalized);
    reset();
  };

  const reset = () => {
    setCellRef("");
    setError(null);
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Dialog dismissed without action -- no insertion
      setCellRef("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>Reference cells from {spreadsheetName}</DialogTitle>
          <DialogDescription>
            Enter a cell (e.g., A1) or range (e.g., A1:C3). Leave blank to
            insert as a link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="A1 or A1:C3"
              value={cellRef}
              onChange={(e) => {
                setCellRef(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              {cellRef.trim() ? "Insert Reference" : "Insert Link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
