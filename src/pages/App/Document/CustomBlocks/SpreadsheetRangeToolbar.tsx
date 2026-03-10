import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, Eye, EyeOff, Table } from "lucide-react";

interface SpreadsheetRangeToolbarProps {
  showHeaders: boolean;
  onToggleHeaders: () => void;
  onCloneAsTable: () => void;
  onCloneAsLinkedRange: () => void;
}

export function SpreadsheetRangeToolbar({
  showHeaders,
  onToggleHeaders,
  onCloneAsTable,
  onCloneAsLinkedRange,
}: SpreadsheetRangeToolbarProps) {
  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger
            render={<button
              type="button"
              className="flex p-0.5 items-center justify-center cursor-pointer rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={onToggleHeaders}
            />}
          >
              {showHeaders ? <Eye size={12} /> : <EyeOff size={12} />}
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">
              {showHeaders ? "Hide" : "Show"} row/column headers
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<button
              type="button"
              className="flex p-0.5 items-center justify-center cursor-pointer rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={onCloneAsTable}
            />}
          >
              <Table size={12} />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">Clone as editable table</span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<button
              type="button"
              className="flex p-0.5 items-center justify-center cursor-pointer rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={onCloneAsLinkedRange}
            />}
          >
              <Copy size={12} />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">Clone as linked range</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
