// Phase-2 of CSV import validation — per-row drill-down.
//
// Opened from the "Show details" action on the failed-validation toast.
// We re-run the strict zod schema once per row, decorate each issue with
// the offending cell value, and present a scrollable table.
//
// Phase-1 (toast summary) and phase-2 (this dialog) intentionally use the
// SAME schema from @ripple/shared/taskImportSchema — there's no separate
// "row schema" — so a successful phase-2 implies a fixable phase-1 too.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TASK_IMPORT_HEADERS,
  taskImportRowSchema,
} from "@ripple/shared/taskImportSchema";
import { Download } from "lucide-react";

interface RowFailure {
  rowNumber: number; // 1-based, header excluded
  field: string;
  value: string;
  message: string;
}

/**
 * Papaparse with `header: true` and no `dynamicTyping` always yields a
 * record of string cells; that's the input contract for this dialog. Keeping
 * the type tight here means we never need runtime type-narrowing on cells.
 */
type CsvRow = Record<string, string>;

interface Props {
  open: boolean;
  rows: CsvRow[];
  onOpenChange: (open: boolean) => void;
}

export function ImportTasksValidationDialog({ open, rows, onOpenChange }: Props) {
  const failures: RowFailure[] = (() => {
    if (!open || rows.length === 0) return [];
    const out: RowFailure[] = [];
    for (const [idx, row] of rows.entries()) {
      const result = taskImportRowSchema.safeParse(row);
      if (result.success) continue;
      for (const iss of result.error.issues) {
        const field = String(iss.path[0] ?? "");
        out.push({
          rowNumber: idx + 1,
          field,
          value: row[field] ?? "",
          message: iss.message,
        });
      }
    }
    return out;
  })();

  const downloadReport = () => {
    const header = "row,field,value,error";
    const body = failures
      .map((f) =>
        [f.rowNumber, f.field, csvCell(f.value), csvCell(f.message)].join(","),
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "task-import-errors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[min(96vw,72rem)]">
        <DialogHeader>
          <DialogTitle>CSV validation errors</DialogTitle>
          <DialogDescription>
            {failures.length === 0
              ? "No errors found. (Try re-uploading the CSV.)"
              : `${failures.length} cell${failures.length === 1 ? "" : "s"} need attention. Expected columns, in order: ${TASK_IMPORT_HEADERS.join(", ")}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium w-16">Row</th>
                <th className="px-3 py-2 font-medium w-40">Field</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f, i) => (
                <tr
                  key={`${f.rowNumber}-${f.field}-${i}`}
                  className="border-t hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {f.rowNumber}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{f.field}</td>
                  <td className="px-3 py-2 font-mono text-xs max-w-[16rem] truncate">
                    {f.value || <span className="text-muted-foreground italic">empty</span>}
                  </td>
                  <td className="px-3 py-2 text-destructive">{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={downloadReport}
            disabled={failures.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Download error report
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quote a cell for CSV output: wrap in quotes if it contains special chars. */
function csvCell(s: string): string {
  if (/[,"\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
