import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { Camera, Loader2 } from "lucide-react";

interface DiagramBlockToolbarProps {
  isSnapshotting: boolean;
  onSnapshot: () => void;
}

/**
 * Hover toolbar for a live diagram embed. Mirrors SpreadsheetRangeToolbar:
 * a linked embed tracks its source, and the toolbar is where you freeze a copy
 * that doesn't.
 */
export function DiagramBlockToolbar({
  isSnapshotting,
  onSnapshot,
}: DiagramBlockToolbarProps) {
  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger
            render={<button
              type="button"
              className="flex p-0.5 items-center justify-center cursor-pointer rounded hover:bg-muted transition-colors text-muted-foreground disabled:cursor-default disabled:opacity-60"
              disabled={isSnapshotting}
              onClick={onSnapshot}
            />}
          >
            {isSnapshotting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Camera size={12} />
            )}
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">
              {isSnapshotting ? "Capturing snapshot…" : "Snapshot as image"}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
