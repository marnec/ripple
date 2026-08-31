// CSV-import job status page.
//
// Rendered at /workspaces/:workspaceId/projects/:projectId/import/:jobId.
// Shows job progress (status, X / Y rows, failed count) and the tasks
// produced by THIS job in creationTime DESC order — newest at the top so
// fresh imports appear above earlier ones in real time.
//
// We deliberately filter by importJobId on the server so previous imports
// in the same project are invisible here.
//
// The list is capped at TASK_IMPORT_TASK_LIST_LIMIT (newest first) so the
// subscription's read set does not grow with the import. When the job produced
// more than that, we say so and point at the project task list.

import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@ripple/ui/components/button";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache";
import { useMutation } from "convex/react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import type { QueryParams } from "@convex/types/routes";
import {
  TASK_IMPORT_MAX_ROW_ERRORS,
  TASK_IMPORT_TASK_LIST_LIMIT,
} from "@ripple/shared/taskImportSchema";
import { TaskRow } from "./TaskRow";

export function ProjectTaskImport() {
  const { workspaceId, projectId, jobId } = useParams<
    QueryParams & { jobId: Id<"taskImportJobs"> }
  >();

  if (!workspaceId || !projectId || !jobId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectTaskImportContent
      workspaceId={workspaceId}
      projectId={projectId}
      jobId={jobId}
    />
  );
}

function ProjectTaskImportContent({
  workspaceId,
  projectId,
  jobId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  jobId: Id<"taskImportJobs">;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const job = useQuery(api.taskImports.getJob, { jobId });
  const tasks = useQuery(api.taskImports.listJobTasks, { jobId });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);
  const cancelImport = useMutation(api.taskImports.cancelImportJob);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (job === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RippleSpinner size={32} />
      </div>
    );
  }
  if (job === null) {
    return <SomethingWentWrong />;
  }

  const pct =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
  const isTerminal = job.status === "completed" || job.status === "failed";

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <StatusBadge status={job.status} />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">CSV import</h1>
              <p className="text-xs text-muted-foreground">
                {job.processedRows} / {job.totalRows} processed
                {job.failedRows > 0 && (
                  <>
                    {" · "}
                    <span className="text-destructive">
                      {job.failedRows} failed
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          {isTerminal ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigate(
                  `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
                )
              }
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to tasks
            </Button>
          ) : (
            // An import that has died leaves this page showing "Queued"
            // forever while the project's Import button stays disabled. The
            // job expires on its own eventually; this is for the person who
            // already knows it is not coming back.
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel import
            </Button>
          )}
        </div>
        <Progress value={pct} className="h-1.5" />
        {job.errorMessage && (
          <p className="text-xs text-destructive">{job.errorMessage}</p>
        )}
        {job.rowErrors && job.rowErrors.length > 0 && (
          <RowErrors
            rowErrors={job.rowErrors}
            failedRows={job.failedRows}
          />
        )}
      </header>

      <div className="flex-1 overflow-auto">
        {tasks === undefined ? (
          <div className="flex items-center justify-center py-8">
            <RippleSpinner size={24} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-1">
            <Clock className="h-5 w-5" />
            <span>Tasks will appear here as they are imported…</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {tasks.length === TASK_IMPORT_TASK_LIST_LIMIT && (
              <p className="pb-1 text-xs text-muted-foreground">
                Showing the {TASK_IMPORT_TASK_LIST_LIMIT} most recent imported
                tasks.{" "}
                <button
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() =>
                    void navigate(
                      `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
                    )
                  }
                >
                  See all in the project
                </button>
              </p>
            )}
            {tasks.map((task) => (
              <TaskRow
                key={task._id}
                task={task}
                statuses={statuses ?? undefined}
                hideStatusMenu={isMobile}
                flush={isMobile}
                onStatusChange={(statusId) => {
                  void updateTask({
                    taskId: task._id,
                    statusId: statusId as Id<"taskStatuses">,
                  });
                }}
                onClick={() => {
                  void navigate(
                    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${task._id}`,
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      <ResponsiveDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Cancel this import?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Tasks already imported are kept. Any rows still to come are not
              imported, and the project can start a new import straight away.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setConfirmingCancel(false)}>
              Keep importing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void cancelImport({ jobId })
                  .then(() => setConfirmingCancel(false))
                  .catch((error: unknown) => {
                    toast.error("Could not cancel the import", {
                      description:
                        error instanceof Error ? error.message : "Please try again",
                    });
                  });
              }}
            >
              Cancel import
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

/**
 * Why rows were dropped.
 *
 * A count on its own ("3 failed") is unactionable — the whole point of the
 * import is that the file goes in unattended, so the only thing the person
 * can do afterwards is fix the rows they were told about. The list is capped
 * server-side; the cap is stated rather than hidden, since a file that fails
 * this way usually fails the same way on every row.
 */
function RowErrors({
  rowErrors,
  failedRows,
}: {
  rowErrors: { row: number; field?: string; message: string }[];
  failedRows: number;
}) {
  const capped = rowErrors.length >= TASK_IMPORT_MAX_ROW_ERRORS;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-xs font-medium text-destructive">
        {failedRows === 1 ? "1 row was skipped" : `${failedRows} rows were skipped`}
      </p>
      <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-auto text-xs text-muted-foreground">
        {rowErrors.map((e, i) => (
          <li key={`${e.row}-${e.field ?? ""}-${i}`}>
            <span className="font-mono text-foreground">Row {e.row}</span>
            {e.field && <span className="font-mono"> · {e.field}</span>} —{" "}
            {e.message}
          </li>
        ))}
      </ul>
      {capped && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Only the first {TASK_IMPORT_MAX_ROW_ERRORS} problems are listed.
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "queued" | "running" | "completed" | "failed" }) {
  switch (status) {
    case "queued":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
          <Clock className="h-3 w-3" /> Queued
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
          <XCircle className="h-3 w-3" /> Failed
        </span>
      );
  }
}
