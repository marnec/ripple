// Sticky cross-page notice that a CSV task import is running for this
// project. Clicking the banner jumps to the import-job status page.
//
// Lives between the project header and the page outlet (see
// ProjectLayout). Renders nothing when no active job exists.
//
// It also renders nothing while the import status page itself is open: the
// banner is a shortcut to that page, and an import is short enough that
// showing it there would insert a stripe above the page on "queued" and pull
// it back out on "completed" — two layout shifts, seconds apart, on the one
// page that already reports the same progress. That page is inside this
// layout's outlet, which is why the query is skipped rather than merely
// ignored there — otherwise it and `getJob` held two live subscriptions to the
// same document, both re-firing on every batch.
//
// `useLiveImportJob` is what decides the job is still running. The query used
// to answer that itself and could not: see `use-import-job-liveness.ts`.

import { useIsMobile } from "@/hooks/use-mobile";
import { useLiveImportJob } from "@/hooks/use-import-job-liveness";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowRight, Loader2 } from "lucide-react";
import { Link, useMatch } from "react-router-dom";

interface Props {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}

export function ImportActiveBanner({ workspaceId, projectId }: Props) {
  const isMobile = useIsMobile();
  const onImportPage = useMatch(
    "/workspaces/:workspaceId/projects/:projectId/import/:jobId",
  );
  // CSV import is a desktop-only flow (see ImportTasksButton); the banner is
  // hidden on mobile so the import UI surface stays consistent, and skipping
  // the query is how that stays true of the subscription too.
  const hidden = isMobile || onImportPage !== null;
  const activeJob = useQuery(
    api.taskImports.getActiveJobForProject,
    hidden ? "skip" : { projectId },
  );
  const job = useLiveImportJob(activeJob);
  if (hidden || !job) return null;

  const pct =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

  return (
    <Link
      to={`/workspaces/${workspaceId}/projects/${projectId}/import/${job._id}`}
      className="group flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-500/15 transition-colors"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="flex-1 truncate">
        Importing tasks — {job.processedRows} / {job.totalRows} processed ({pct}%)
      </span>
      <span className="hidden sm:inline opacity-70 group-hover:opacity-100">
        View status
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
