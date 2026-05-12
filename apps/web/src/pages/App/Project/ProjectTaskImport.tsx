// CSV-import job status page.
//
// Rendered at /workspaces/:workspaceId/projects/:projectId/import/:jobId.
// Shows job progress (status, X / Y rows, failed count) and the tasks
// produced by THIS job in creationTime DESC order — newest at the top so
// fresh imports appear above earlier ones in real time.
//
// We deliberately filter by importJobId on the server so previous imports
// in the same project are invisible here.

import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { useNavigate, useParams } from "react-router-dom";
import type { QueryParams } from "@ripple/shared/types/routes";
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
          {isTerminal && (
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
          )}
        </div>
        <Progress value={pct} className="h-1.5" />
        {job.errorMessage && (
          <p className="text-xs text-destructive">{job.errorMessage}</p>
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
