import { type FormEvent, useState } from "react";
import { useAction } from "convex/react";
import {
  exceedsMaxCells,
  isSingleCell,
  isValidCellRef,
  normalizeCellRef,
} from "@ripple/shared/cellRef";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface RepointCellRefDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  /** Mode determines validation: a single-cell chip can only repoint to a
   *  single cell; a range block can only repoint to a range. */
  mode: "cell" | "range";
  /** Last-known A1, used to prefill the input. */
  initialCellRef: string;
  /** Called with the new normalized A1 + freshly-computed stableRef once the
   *  user confirms. The stableRef may be null if the spreadsheet snapshot
   *  doesn't yet have order arrays — caller should still proceed and let the
   *  server back-fill on next populate. */
  onRepoint: (cellRef: string, stableRef: string | null) => void;
}

export function RepointCellRefDialog({
  open,
  onOpenChange,
  spreadsheetId,
  spreadsheetName,
  mode,
  initialCellRef,
  onRepoint,
}: RepointCellRefDialogProps) {
  const [cellRef, setCellRef] = useState(initialCellRef);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const prepareStableRef = useAction(api.spreadsheetCellRefsNode.prepareStableRef);

  const reset = () => {
    setCellRef(initialCellRef);
    setError(null);
    setSubmitting(false);
    onOpenChange(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = cellRef.trim();
    if (!trimmed) {
      setError("Enter a cell or range.");
      return;
    }
    const normalized = normalizeCellRef(trimmed);
    if (!isValidCellRef(normalized)) {
      setError("Invalid reference. Use A1 or A1:C3.");
      return;
    }
    if (exceedsMaxCells(normalized)) {
      setError("Range too large. Maximum 100 cells.");
      return;
    }
    if (mode === "cell" && !isSingleCell(normalized)) {
      setError("This block expects a single cell. Use the form A1.");
      return;
    }
    if (mode === "range" && isSingleCell(normalized)) {
      setError("This block expects a range. Use the form A1:C3.");
      return;
    }

    setSubmitting(true);
    try {
      const stableRef = await prepareStableRef({ spreadsheetId, cellRef: normalized });
      onRepoint(normalized, stableRef ?? null);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve reference.");
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    else onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>Repoint reference in {spreadsheetName}</DialogTitle>
          <DialogDescription>
            The cell or range previously referenced was deleted. Enter a new
            {mode === "cell" ? " cell (e.g., A1)" : " range (e.g., A1:C3)"}
            {" to repoint this embed."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="grid gap-4 py-4">
            <Input
              autoFocus
              placeholder={mode === "cell" ? "A1" : "A1:C3"}
              value={cellRef}
              onChange={(e) => {
                setCellRef(e.target.value);
                setError(null);
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Repointing…" : "Repoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
