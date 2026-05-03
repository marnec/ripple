import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { Id } from "@convex/_generated/dataModel";
import { consumePendingImportFile } from "./spreadsheet-import-state";

const createSpreadsheetRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; name?: string },
  Id<"spreadsheets">
>("spreadsheets:create");

interface ParsedWorksheet {
  worksheetName?: string;
  data: unknown[][];
}

type Status = "parsing" | "picking" | "creating";

export function SpreadsheetImport() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createSpreadsheet = useMutation(createSpreadsheetRef);
  const [status, setStatus] = useState<Status>("parsing");
  const [statusMessage, setStatusMessage] = useState("Reading file…");
  const [sheets, setSheets] = useState<ParsedWorksheet[]>([]);
  // File and fileName are seeded synchronously once workspaceId is known.
  // `pendingFile === undefined` means we haven't tried to consume yet.
  const [pendingFile, setPendingFile] = useState<File | null | undefined>(
    undefined,
  );
  const [fileName, setFileName] = useState("");

  const cancel = () => {
    void navigate(`/workspaces/${workspaceId ?? ""}/spreadsheets`, {
      replace: true,
    });
  };

  const finishImport = async (sheet: ParsedWorksheet) => {
    if (!workspaceId) return;
    try {
      setStatus("creating");
      setStatusMessage("Creating spreadsheet…");
      const baseName = fileName.replace(/\.(xlsx|xls|csv|ods|tsv)$/i, "");
      const sheetSuffix =
        sheet.worksheetName && sheets.length > 1
          ? ` — ${sheet.worksheetName}`
          : "";
      const name = `${baseName || "Imported Spreadsheet"}${sheetSuffix}`;
      const spreadsheetId = await createSpreadsheet({ workspaceId, name });
      void navigate(
        `/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`,
        {
          replace: true,
          state: { importedRows: sheet.data },
        },
      );
    } catch (err) {
      console.error("Spreadsheet import failed:", err);
      toast.error("Failed to create the imported spreadsheet.");
      cancel();
    }
  };

  // Synchronously consume the pending file the first time we have a
  // workspaceId. Render-time setState avoids the eslint set-state-in-effect
  // rule and keeps fileName in sync with the file we'll parse.
  if (workspaceId && pendingFile === undefined) {
    const f = consumePendingImportFile();
    setPendingFile(f);
    if (f) setFileName(f.name);
  }

  useEffect(() => {
    if (pendingFile === undefined) return; // not consumed yet
    if (pendingFile === null) {
      cancel();
      return;
    }

    const file = pendingFile;
    void (async () => {
      try {
        setStatusMessage("Parsing spreadsheet…");
        const tabularjs = (await import("tabularjs")).default;
        const result = await tabularjs(file);
        const parsed = (result.worksheets ?? []) as ParsedWorksheet[];
        const nonEmpty = parsed.filter(
          (w) => Array.isArray(w.data) && w.data.length > 0,
        );

        if (nonEmpty.length === 0) {
          toast.error("No content could be extracted from this file.");
          cancel();
          return;
        }

        if (nonEmpty.length === 1) {
          await finishImport(nonEmpty[0]);
          return;
        }

        setSheets(nonEmpty);
        setStatus("picking");
      } catch (err) {
        console.error("Spreadsheet parse failed:", err);
        toast.error("Failed to read this file. Try .xlsx, .xls, or .csv.");
        cancel();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFile]);

  if (status === "picking") {
    return (
      <div className="h-full flex-1 min-w-0 flex flex-col">
        <div className="flex-1 flex justify-center items-start pt-12 px-4">
          <div className="w-full max-w-md space-y-4 animate-fade-in">
            <div>
              <h2 className="text-lg font-semibold">Pick a sheet to import</h2>
              <p className="text-sm text-muted-foreground">
                {fileName} contains {sheets.length} sheets. Choose one — only the
                selected sheet will be imported.
              </p>
            </div>
            <div className="space-y-2">
              {sheets.map((sheet, i) => {
                const rowCount = sheet.data.length;
                const colCount = sheet.data.reduce(
                  (m, r) => Math.max(m, r.length),
                  0,
                );
                return (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left rounded-md border bg-card hover:bg-accent transition-colors p-3"
                    onClick={() => void finishImport(sheet)}
                  >
                    <div className="font-medium">
                      {sheet.worksheetName || `Sheet ${i + 1}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {rowCount} {rowCount === 1 ? "row" : "rows"} ×{" "}
                      {colCount} {colCount === 1 ? "column" : "columns"}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex-1 min-w-0 flex flex-col relative">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RippleSpinner size={64} />
          <p className="text-sm text-muted-foreground animate-pulse">
            {statusMessage}
          </p>
        </div>
      </div>
    </div>
  );
}
