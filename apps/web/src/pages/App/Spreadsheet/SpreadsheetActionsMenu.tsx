import { useState } from "react";
import { FileSpreadsheet, FileType2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { ShareDialog } from "@/components/ShareDialog";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
import {
  exportSpreadsheetCsv,
  exportSpreadsheetXlsx,
} from "@/lib/exporters/spreadsheet";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import type { Id } from "@convex/_generated/dataModel";

interface SpreadsheetActionsMenuProps {
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  isAdmin: boolean;
  binding: SpreadsheetYjsBinding | null;
}

export function SpreadsheetActionsMenu({
  spreadsheetId,
  spreadsheetName,
  isAdmin,
  binding,
}: SpreadsheetActionsMenuProps) {
  const [shareOpen, setShareOpen] = useState(false);

  const guard = (fn: (b: SpreadsheetYjsBinding) => Promise<void> | void, errorMsg: string) => () => {
    if (!binding) {
      toast.error("Spreadsheet is still loading.");
      return;
    }
    void (async () => {
      try {
        await fn(binding);
      } catch (err) {
        console.error(err);
        toast.error(errorMsg);
      }
    })();
  };

  return (
    <>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Share & download"
            >
              <Share2 className="size-4" />
            </button>
          }
        />
        <ResponsiveDropdownMenuContent align="end" className="w-52 rounded-lg">
          {isAdmin && (
            <>
              <ResponsiveDropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="text-muted-foreground" />
                <span>Share…</span>
              </ResponsiveDropdownMenuItem>
              <ResponsiveDropdownMenuSeparator />
            </>
          )}
          <ResponsiveDropdownMenuItem
            onSelect={guard((b) => exportSpreadsheetCsv(b, spreadsheetName), "Failed to export CSV.")}
          >
            <FileType2 className="text-muted-foreground" />
            <span>Download as CSV</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem
            onSelect={guard((b) => exportSpreadsheetXlsx(b, spreadsheetName), "Failed to export XLSX.")}
          >
            <FileSpreadsheet className="text-muted-foreground" />
            <span>Download as XLSX</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
      {isAdmin && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="spreadsheet"
          resourceId={spreadsheetId}
          resourceName={spreadsheetName}
        />
      )}
    </>
  );
}
