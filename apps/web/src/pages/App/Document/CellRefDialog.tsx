import { type FormEvent, useRef, useState } from "react";
import { Button } from "@ripple/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ripple/ui/components/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@ripple/ui/components/input-group";
import {
  isValidCellRef,
  exceedsMaxCells,
  normalizeCellRef,
} from "@ripple/shared/cellRef";
import type { Id } from "@convex/_generated/dataModel";
import { RangeSelectorButton } from "./RangeSelectorButton";
import { SpreadsheetCellPicker } from "./SpreadsheetCellPicker";

interface CellRefDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  onInsert: (cellRef: string | null) => void;
  /**
   * Asked about each ref that passes validation, for anything worth saying
   * about it that the string alone cannot answer — the dialog holds the ref,
   * the caller holds the data. A returned message is shown as a warning and
   * never blocks the insert: it describes what the user is about to get, not
   * a reason they can't have it.
   */
  rangeWarning?: (cellRef: string) => string | null;
  /**
   * Whether a range can be confirmed right now. False while the caller is still
   * getting hold of the data a range would resolve against — the blank-field
   * "insert as link" path stays available either way. Defaults to true for
   * callers that resolve the range themselves after the fact.
   */
  rangeReady?: boolean;
}

export function CellRefDialog({
  open,
  onOpenChange,
  spreadsheetId,
  spreadsheetName,
  onInsert,
  rangeWarning,
  rangeReady = true,
}: CellRefDialogProps) {
  const [cellRef, setCellRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only a ref that would actually be inserted is worth describing: an
  // unparseable or oversized one already has an error of its own, and asking
  // the caller about a half-typed "A" would flash a warning at every keystroke.
  const typed = normalizeCellRef(cellRef.trim());
  const insertable =
    typed !== "" && rangeReady && isValidCellRef(typed) && !exceedsMaxCells(typed);
  const warning = insertable ? (rangeWarning?.(typed) ?? null) : null;

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

    // Enter submits the form even while the button is disabled, so the
    // not-ready gate has to be stated here too, not only on the button.
    if (!rangeReady) return;

    const normalized = normalizeCellRef(trimmed);

    if (!isValidCellRef(normalized)) {
      setError("Invalid cell reference. Use A1 for a cell or A1:C3 for a range.");
      return;
    }

    if (exceedsMaxCells(normalized)) {
      setError("Range too large. Maximum 100 cells (e.g., 10×10).");
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

  const handlePickerConfirm = (picked: string) => {
    setCellRef(picked);
    setError(null);
    setPickerOpen(false);
    // Restore focus to the input so the user can tweak or press Enter.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <>
      {/* Hide the dialog while the picker is open so they don't stack
          visually. Component state (cellRef, error) is preserved because
          this component stays mounted. */}
      <Dialog open={open && !pickerOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-100">
          <DialogHeader>
            <DialogTitle>Reference cells from {spreadsheetName}</DialogTitle>
            <DialogDescription>
              Enter a cell (e.g., A1) or range (e.g., A1:C3), or click the
              selector to pick visually. Leave blank to insert as a link.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <InputGroup>
                <InputGroupInput
                  ref={inputRef}
                  placeholder="A1 or A1:C3"
                  value={cellRef}
                  onChange={(e) => {
                    setCellRef(e.target.value);
                    setError(null);
                  }}
                  autoFocus
                />
                <InputGroupAddon align="inline-end">
                  <RangeSelectorButton onClick={() => setPickerOpen(true)} />
                </InputGroupAddon>
              </InputGroup>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              {!error && warning && (
                <p className="text-sm text-amber-600 dark:text-amber-400 animate-fade-in">
                  {warning}
                </p>
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
              <Button type="submit" disabled={!!cellRef.trim() && !rangeReady}>
                {cellRef.trim() ? "Insert Reference" : "Insert Link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <SpreadsheetCellPicker
        open={open && pickerOpen}
        spreadsheetId={spreadsheetId}
        spreadsheetName={spreadsheetName}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  );
}
