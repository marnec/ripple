import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { ShiftOp } from "@/lib/formulaShift";
import type { AffectedExternalRef } from "@/hooks/use-spreadsheet-context-menu";

const OP_LABELS: Record<ShiftOp["type"], string> = {
  insertRow: "Insert row",
  deleteRow: "Delete row",
  insertCol: "Insert column",
  deleteCol: "Delete column",
};

const PREVIEW_LIMIT = 8;

type ConfirmRefShiftDialogProps = {
  op: ShiftOp;
  affected: AffectedExternalRef[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmRefShiftDialog({
  op,
  affected,
  onConfirm,
  onCancel,
}: ConfirmRefShiftDialogProps) {
  const isDelete = op.type === "deleteRow" || op.type === "deleteCol";
  const broken = affected.filter((a) => a.after === "#REF!").length;
  const preview = affected.slice(0, PREVIEW_LIMIT);
  const remaining = affected.length - preview.length;

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{OP_LABELS[op.type]}?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This change will shift {affected.length} external{" "}
            {affected.length === 1 ? "reference" : "references"} pointing into this
            spreadsheet
            {broken > 0 ? `, breaking ${broken} of them` : ""}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ul className="my-2 max-h-60 overflow-auto rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono">
          {preview.map(({ before, after }, i) => (
            <li key={i} className="py-0.5">
              <span>{before}</span>
              <span className="text-muted-foreground"> → </span>
              <span className={after === "#REF!" ? "text-destructive" : undefined}>
                {after}
              </span>
            </li>
          ))}
          {remaining > 0 && (
            <li className="py-0.5 text-muted-foreground">
              … and {remaining} more
            </li>
          )}
        </ul>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={isDelete ? "destructive" : "default"} onClick={onConfirm}>
            {OP_LABELS[op.type]}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
