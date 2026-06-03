import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getSourceLink,
  SOURCE_TYPE_LABELS,
  type Reference,
} from "@/components/embed-references";

type FrameDeleteWarningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Name of the frame being deleted (falls back to "This frame"). */
  frameName?: string;
  /** Places that embed this frame — already loaded by the caller. */
  references: Reference[];
};

// Frames embed in few places; show a handful and summarize the rest.
const MAX_SHOWN = 8;

/**
 * Confirms deletion of an Excalidraw frame that is embedded in one or more
 * documents/tasks, listing those places. Sibling of {@link DeleteWarningDialog}
 * (whole-resource delete) — reuses its source-link/label helpers — but the
 * references are passed in rather than queried, since the diagram editor
 * already subscribes to them via `edges.getFrameEmbeds`.
 */
export function FrameDeleteWarningDialog({
  open,
  onOpenChange,
  onConfirm,
  frameName,
  references,
}: FrameDeleteWarningDialogProps) {
  const shown = references.slice(0, MAX_SHOWN);
  const overflow = references.length - shown.length;
  const label = frameName ? `"${frameName}"` : "This frame";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete frame?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription render={<div />}>
            <span className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-medium mb-3">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {label} is embedded in {references.length}{" "}
              {references.length === 1 ? "place" : "places"}:
            </span>
            <ul className="space-y-1.5 mb-2">
              {shown.map((ref) => {
                const config =
                  SOURCE_TYPE_LABELS[ref.sourceType] ??
                  SOURCE_TYPE_LABELS.document;
                const Icon = config.icon;
                return (
                  <li
                    key={ref._id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Link
                      to={getSourceLink(ref)}
                      className="truncate hover:underline text-foreground"
                      onClick={() => onOpenChange(false)}
                    >
                      {ref.sourceName}
                    </Link>
                    <span className="text-muted-foreground text-xs shrink-0">
                      ({config.label})
                    </span>
                  </li>
                );
              })}
            </ul>
            {overflow > 0 && (
              <p className="text-xs text-muted-foreground mb-2">
                and {overflow} more {overflow === 1 ? "place" : "places"}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              These embeds will fall back to the whole diagram after deletion.
              This action cannot be undone.
            </p>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete frame
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
