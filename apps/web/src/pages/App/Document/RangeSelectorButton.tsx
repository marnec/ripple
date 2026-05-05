import { BoxSelect } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RangeSelectorButtonProps {
  onClick: () => void;
}

/**
 * Excel-style "select cells visually" button. Lives inside the cell-ref input
 * row and opens the {@link SpreadsheetCellPicker} overlay when clicked.
 */
export function RangeSelectorButton({ onClick }: RangeSelectorButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClick}
              aria-label="Select cells on sheet"
            >
              <BoxSelect className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Select on sheet</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
