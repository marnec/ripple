// CSV task import — toolbar button.
//
// Lives immediately to the left of the "New task" button on the desktop
// project tasks page. The button is disabled (with explanatory tooltip)
// whenever another import is in progress for the same project; the
// ImportActiveBanner is the way to navigate to that job.
//
// On file pick we run the full validation pipeline synchronously:
//   1. papaparse CSV → row objects
//   2. header order check against TASK_IMPORT_HEADERS
//   3. phase-1 zod parse over the whole array (one cheap pass)
//   4. payload size pre-check (Convex 1MB doc limit)
//   5. createImportJob mutation → navigate to the job status page
// Any failure short-circuits with a Sonner toast; the "Show details" action
// opens ImportTasksValidationDialog for the phase-2 per-row drill-down.
//
// Step 5 sends the RAW papaparse rows, not the zod output. The row schema
// coerces (tags "a;b" → ["a","b"], estimate "3" → 3, "" → null), so it is not
// idempotent — re-parsing its own output rejects every transformed cell. The
// server re-runs the same schema as the authoritative pass and stores what it
// produces; the parse here exists only to fail fast with a readable message.

import { Button } from "@ripple/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ripple/ui/components/tooltip";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  TASK_IMPORT_HEADERS,
  TASK_IMPORT_MAX_PAYLOAD_BYTES,
  buildTaskImportTemplateCsv,
  stripTaskImportExampleRows,
  taskImportRowsSchema,
} from "@ripple/shared/taskImportSchema";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useLiveImportJob } from "@/hooks/use-import-job-liveness";
import { ChevronDown, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { ZodIssue } from "zod";
import { ImportTasksValidationDialog } from "./ImportTasksValidationDialog";

interface Props {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
}

export function ImportTasksButton({ projectId, workspaceId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const createImportJob = useMutation(api.taskImports.createImportJob);

  // Drives the disabled state. The query returns the project's most recently
  // active queued-or-running job without judging whether it is still moving —
  // that is a wall-clock question a Convex query cannot stay right about, so a
  // job whose drain died used to keep this button disabled until the hourly
  // sweep. `useLiveImportJob` applies the deadline and re-renders when it
  // passes; see `use-import-job-liveness.ts`.
  const activeJob = useLiveImportJob(
    useQuery(api.taskImports.getActiveJobForProject, { projectId }),
  );
  const hasActiveJob = activeJob != null;

  // Phase-2 dialog state — populated when phase-1 fails and the user clicks
  // "Show details". We keep the raw parsed rows so the dialog can re-parse
  // per row and decorate each issue with its offending cell value.
  // Rows stay typed as Papa.parse's output (strings only — we don't enable
  // dynamicTyping) so the validation dialog can index into them without
  // runtime narrowing.
  const [validationDialog, setValidationDialog] = useState<{
    open: boolean;
    rows: Record<string, string>[];
    // Set only when the *server* rejected the rows: its issues are shown
    // as-is rather than re-derived locally, because the two only disagree
    // when this tab is running an older schema — precisely the case where
    // re-parsing here would show an empty, baffling dialog.
    issues?: ServerRowIssue[];
  }>({ open: false, rows: [] });

  // Prefetch papaparse so the chunk loads in parallel with the file dialog.
  const prefetchParser = () => {
    void import("papaparse");
  };

  const downloadTemplate = () => {
    // Header line + one filled-in example row (see the shared schema): the
    // formats that actually get rejected — dates, the `;` tag separator, the
    // priority vocabulary — are not guessable from column names alone.
    const blob = new Blob([buildTaskImportTemplateCsv()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ripple-tasks-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so the same file can be re-picked after a fix

    try {
      const text = await file.text();
      const Papa = (await import("papaparse")).default;

      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: "greedy",
      });

      if (parsed.errors.length > 0) {
        // papaparse parse-level errors usually mean a broken file (mismatched
        // quotes, unparseable bytes). Surface the first as a hint.
        toast.error("Could not read CSV file", {
          description: parsed.errors[0]?.message ?? "Unknown parse error",
        });
        return;
      }

      // Header check — strict order. papaparse exposes the parsed header
      // order via meta.fields when header: true.
      const fields = parsed.meta.fields ?? [];
      if (
        fields.length !== TASK_IMPORT_HEADERS.length ||
        fields.some((h, i) => h !== TASK_IMPORT_HEADERS[i])
      ) {
        toast.error("CSV columns are wrong or out of order", {
          description: `Expected: ${TASK_IMPORT_HEADERS.join(", ")}`,
          action: {
            label: "Download template",
            onClick: downloadTemplate,
          },
        });
        return;
      }

      if (parsed.data.length === 0) {
        toast.error("CSV is empty — no rows to import.");
        return;
      }

      // The template's example row is dropped rather than imported: leaving
      // it in is the expected mistake, and the alternative is a task called
      // "EXAMPLE: delete this row" in someone's project.
      const rows = stripTaskImportExampleRows(parsed.data);
      const skippedExamples = parsed.data.length - rows.length;
      if (rows.length === 0) {
        toast.error("Nothing to import", {
          description:
            "The file only contains the template's example row. Replace it with your own tasks.",
        });
        return;
      }

      // Phase 1: validate all rows in one zod pass.
      const result = taskImportRowsSchema.safeParse(rows);
      if (!result.success) {
        const issues = result.error.issues;
        const failedRowIndices = new Set(
          issues
            .map((iss) => iss.path[0])
            .filter((p): p is number => typeof p === "number"),
        );
        toast.error(
          `Validation failed: ${failedRowIndices.size} of ${rows.length} rows have errors`,
          {
            description: firstIssueSummary(issues),
            action: {
              label: "Show details",
              onClick: () => setValidationDialog({ open: true, rows }),
            },
            duration: 10000,
          },
        );
        return;
      }
      // The rows we send are papaparse's, not `result.data` — see the file
      // header. The server owns the transform.

      // Size pre-check — keep client well under Convex's 1MB doc limit.
      // Measured on the payload actually sent.
      const payloadBytes = new Blob([JSON.stringify(rows)]).size;
      if (payloadBytes >= TASK_IMPORT_MAX_PAYLOAD_BYTES) {
        toast.error("CSV too large to import in a single job", {
          description:
            "Please split the file into multiple smaller CSVs and import them one at a time.",
        });
        return;
      }

      // All good — create the job and jump to its status page.
      try {
        const jobId = await createImportJob({
          projectId,
          workspaceId,
          rows,
        });
        if (skippedExamples > 0) {
          toast.info(
            skippedExamples === 1
              ? "The template's example row was skipped."
              : `${skippedExamples} example rows were skipped.`,
          );
        }
        void navigate(
          `/workspaces/${workspaceId}/projects/${projectId}/import/${jobId}`,
        );
      } catch (err) {
        const failure = describeImportFailure(err);
        toast.error("Could not start import", {
          description: failure.description,
          duration: failure.issues || failure.jobId ? 10000 : undefined,
          ...(failure.issues
            ? {
                action: {
                  label: "Show details",
                  onClick: () =>
                    setValidationDialog({
                      open: true,
                      rows,
                      issues: failure.issues,
                    }),
                },
              }
            : failure.jobId
              ? {
                  action: {
                    label: "View import",
                    onClick: () =>
                      void navigate(
                        `/workspaces/${workspaceId}/projects/${projectId}/import/${failure.jobId}`,
                      ),
                  },
                }
              : {}),
        });
      }
    } catch (err) {
      console.error("Task CSV import failed:", err);
      toast.error("Failed to read CSV file.");
    }
  };

  // While the active-job query is loading we still let the user click — the
  // mutation does the authoritative check. This avoids a flicker on first
  // mount where the button briefly looks enabled-then-disabled.
  const buttonGroup = (
    <DropdownMenu>
      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          disabled={hasActiveJob}
          onClick={() => fileInputRef.current?.click()}
          onMouseEnter={prefetchParser}
          onFocus={prefetchParser}
          className="rounded-r-none border-r-0"
        >
          <Upload className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={hasActiveJob}
              className="rounded-l-none px-2"
              aria-label="Import options"
            />
          }
        >
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={downloadTemplate}>
          <Download className="h-4 w-4 mr-2" />
          Download template
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {hasActiveJob ? (
        <Tooltip>
          <TooltipTrigger render={<span />}>{buttonGroup}</TooltipTrigger>
          <TooltipContent>
            Import in progress — click the banner to view it.
          </TooltipContent>
        </Tooltip>
      ) : (
        buttonGroup
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />
      <ImportTasksValidationDialog
        open={validationDialog.open}
        rows={validationDialog.rows}
        issues={validationDialog.issues}
        onOpenChange={(open) =>
          setValidationDialog((s) => ({ ...s, open }))
        }
      />
    </>
  );
}

/**
 * What the mutation's rejection means, in a sentence a person can act on.
 *
 * `ConvexError.message` is the serialized payload — the
 * `Uncaught ConvexError: {"code":"INVALID_ROWS",…}` blob — so the structured
 * `data` is read instead, and the row issues come back with it so the details
 * dialog can list them.
 */
function describeImportFailure(err: unknown): {
  description: string;
  issues?: ServerRowIssue[];
  jobId?: string;
} {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === "string") return { description: data };
    if (data && typeof data === "object") {
      const payload = data as {
        code?: unknown;
        message?: unknown;
        issues?: unknown;
        jobId?: unknown;
      };
      if (payload.code === "INVALID_ROWS" && Array.isArray(payload.issues)) {
        const issues = payload.issues as ServerRowIssue[];
        const rowCount = new Set(issues.map((iss) => iss.path[0])).size;
        return {
          description: `${issues.length} cell${issues.length === 1 ? "" : "s"} in ${rowCount} row${rowCount === 1 ? "" : "s"} were rejected — ${serverIssueSummary(issues)}`,
          issues,
        };
      }
      if (typeof payload.message === "string") {
        return {
          description: payload.message,
          ...(typeof payload.jobId === "string" ? { jobId: payload.jobId } : {}),
        };
      }
    }
  }
  return {
    description: err instanceof Error ? err.message : String(err),
  };
}

/** Server-reported issue: same shape zod gives, with the path stringified. */
export interface ServerRowIssue {
  path: string[];
  message: string;
}

/** Same one-line summary as the local pass, for server-reported issues. */
function serverIssueSummary(issues: ServerRowIssue[]): string {
  const first = issues[0];
  if (!first) return "";
  const rowIndex = Number(first.path[0]);
  const where = Number.isNaN(rowIndex) ? "Row ?" : `row ${rowIndex + 1}`;
  const field = first.path[1];
  return field
    ? `${where}, ${field}: ${first.message}`
    : `${where}: ${first.message}`;
}

/** Short human summary of the first issue, used as the toast description. */
function firstIssueSummary(issues: ZodIssue[]): string {
  const first = issues[0];
  if (!first) return "";
  // path looks like [rowIndex, "fieldName"] for an array of objects.
  const rowIndex = typeof first.path[0] === "number" ? first.path[0] : null;
  const field = first.path[1];
  const where = rowIndex !== null ? `Row ${rowIndex + 1}` : "Row ?";
  return field
    ? `${where} — ${String(field)}: ${first.message}`
    : `${where}: ${first.message}`;
}
