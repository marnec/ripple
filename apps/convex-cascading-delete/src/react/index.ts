/*
(1.) React hooks for reactive deletion job status monitoring
(2.) Enables real-time progress tracking in UI components
(3.) Integrates with Convex's reactive query system for automatic updates

This module provides React hooks that wrap the component's status queries,
enabling UI components to reactively display deletion progress. The hook
automatically updates as batches complete, providing real-time feedback
for long-running deletion operations. The hook gracefully handles null
job IDs for inline deletions that don't require progress tracking.
*/

"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";

/**
 * Hook to monitor deletion job status with reactive updates.
 * 
 * @param api - Convex API object containing component queries
 * @param jobId - Job ID to monitor, or null for inline deletions
 * @returns Job status object with progress information, or null
 * 
 * @example
 * ```tsx
 * function DeletionProgress({ jobId }: { jobId: string | null }) {
 *   const status = useDeletionJobStatus(api, jobId);
 *   
 *   if (!status) return null;
 *   
 *   const progress = (status.completedCount / status.totalTargetCount) * 100;
 *   
 *   return (
 *     <div>
 *       <progress value={progress} max={100} />
 *       <p>{status.status}: {status.completedCount} / {status.totalTargetCount}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useDeletionJobStatus(
  api: any,
  jobId: string | null
): {
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  totalTargetCount: number;
  completedCount: number;
  completedSummary: string;
  error?: string;
} | null {
  const result = useQuery(
    api.convexCascadingDelete.lib.getJobStatus as FunctionReference<"query">,
    jobId ? { jobId } : "skip"
  );

  if (!result) {
    return null;
  }

  return result;
}
