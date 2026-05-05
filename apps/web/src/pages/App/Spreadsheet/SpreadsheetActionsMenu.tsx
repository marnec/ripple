import { useState } from "react";
import { FileSpreadsheet, FileType2 } from "lucide-react";
import { toast } from "sonner";
import { ShareDialog } from "@/components/ShareDialog";
import { type DownloadItem, ResourceActionsMenu } from "@/components/ResourceActionsMenu";
import { makeExportHandler } from "@/lib/export-handler";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import type { Id } from "@convex/_generated/dataModel";

const loadExporters = () => import("@/lib/exporters/spreadsheet");

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

  const guarded = makeExportHandler(
    () => binding,
    toast.error,
    "Spreadsheet is still loading.",
  );

  const downloadItems: readonly DownloadItem[] = [
    {
      label: "CSV",
      icon: <FileType2 className="text-muted-foreground" />,
      onSelect: guarded(async (b) => {
        const m = await loadExporters();
        m.exportSpreadsheetCsv(b, spreadsheetName);
      }, "Failed to export CSV."),
    },
    {
      label: "XLSX",
      icon: <FileSpreadsheet className="text-muted-foreground" />,
      onSelect: guarded(async (b) => {
        const m = await loadExporters();
        await m.exportSpreadsheetXlsx(b, spreadsheetName);
      }, "Failed to export XLSX."),
    },
  ];

  return (
    <ResourceActionsMenu
      downloadItems={downloadItems}
      onShare={isAdmin ? () => setShareOpen(true) : undefined}
      shareDialog={isAdmin && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="spreadsheet"
          resourceId={spreadsheetId}
          resourceName={spreadsheetName}
        />
      )}
    />
  );
}
