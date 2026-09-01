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
// page that already reports the same progress.

import { useIsMobile } from "@/hooks/use-mobile";
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
  const job = useQuery(api.taskImports.getActiveJobForProject, { projectId });
  // CSV import is a desktop-only flow (see ImportTasksButton); hide the banner
  // on mobile so the import UI surface stays consistent.
  if (isMobile || onImportPage || !job) return null;

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
