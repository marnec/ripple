/*
(1.) React hooks for reactive deletion job status monitoring
(2.) Enables real-time progress tracking in UI components
(3.) Integrates with Convex's reactive query system for automatic updates

This module provides React hooks that wrap the component's status queries,
enabling UI components to reactively display deletion progress. The hook
automatically updates as steps commit, providing real-time feedback for
long-running deletion operations. The hook gracefully handles null job IDs
for cascades that finished inline and never created a job.
*/

"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import type { BatchJobStatus } from "../component/types.js";

/**
 * Hook to monitor deletion job status with reactive updates.
 *
 * A batched cascade discovers the tree as it deletes it, so there is no
 * total to compute a percentage from. `completedCount` grows as steps
 * commit; `pendingCount` is how many parents are still being expanded.
 *
 * @param api - Convex API object containing component queries
 * @param jobId - Job ID to monitor, or null for cascades that finished inline
 * @returns Job status object with progress information, or null
 *
 * @example
 * ```tsx
 * function DeletionProgress({ jobId }: { jobId: string | null }) {
 *   const status = useDeletionJobStatus(api, jobId);
 *
 *   if (!status) return null;
 *
 *   return (
 *     <p>
 *       {status.status}: {status.completedCount} documents deleted
 *       {status.status === "processing" && ` (${status.pendingCount} parents pending)`}
 *     </p>
 *   );
 * }
 * ```
 */
export function useDeletionJobStatus(
  api: any,
  jobId: string | null
): BatchJobStatus | null {
  const result = useQuery(
    api.convexCascadingDelete.lib.getJobStatus as FunctionReference<"query">,
    jobId ? { jobId } : "skip"
  );

  if (!result) {
    return null;
  }

  return result;
}
