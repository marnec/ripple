import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { applyNormalizedEvent } from "./syncIn";
import type { NormalizedIssueEvent } from "./types";

/**
 * Configuration for a one-shot initial import. Stored on the importJob row
 * at creation; consulted at fetch time by the provider drain action.
 */
export interface ImportFilterConfig {
  /** When false (default), `issue.closed` events are dropped before apply. */
  includeClosed: boolean;
}

/**
 * Pre-allocate the project's task-counter range, then insert a
 * `taskImportJobs` row tracking the integration import. Returns the jobId.
 *
 * Pre-allocation avoids 1000 sequential PATCHes on the hot `projects` row
 * during drain — each task picks its number from the reserved range.
 */
export async function createImportJob(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId: Id<"projects">;
    creatorId: Id<"users">;
    projectIntegrationLinkId: Id<"projectIntegrationLinks">;
    totalRows: number;
  },
): Promise<Id<"taskImportJobs">> {
  const {
    workspaceId,
    projectId,
    creatorId,
    projectIntegrationLinkId,
    totalRows,
  } = args;

  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error(`createImportJob: project ${projectId} not found`);
  }

  // Pre-allocate the contiguous number range. Read-and-advance happens once
  // per import — the drain action assigns numberRangeStart + index per task
  // without coming back to the hot projects row.
  const counter = project.taskCounter ?? 0;
  const numberRangeStart = counter + 1;
  await ctx.db.patch(projectId, { taskCounter: counter + totalRows });

  return ctx.db.insert("taskImportJobs", {
    projectId,
    workspaceId,
    creatorId,
    status: "queued",
    rows: [], // integration imports fetch lazily from the provider drain
    numberRangeStart,
    totalRows,
    processedRows: 0,
    failedRows: 0,
    sourceType: "github_integration",
    projectIntegrationLinkId,
  });
}

/**
 * Apply a batch of normalized events under an existing import job.
 * Each event is dispatched through `applyNormalizedEvent`, with the
 * pre-allocated task-number and the jobId threaded through so each created
 * task gets a stable `number` and an `importJobId` backref.
 *
 * Idempotency is delegated to `applyNormalizedEvent`'s link-row guard —
 * re-applying the same events under the same job is a no-op for tasks that
 * were already imported.
 */
export async function applyImportBatch(
  ctx: MutationCtx,
  args: {
    jobId: Id<"taskImportJobs">;
    events: NormalizedIssueEvent[];
    /** Index of the first event in the overall import sequence — drives
     *  per-task `number` assignment from the job's pre-allocated range. */
    batchStartIndex: number;
  },
): Promise<void> {
  const { jobId, events } = args;

  const job = await ctx.db.get(jobId);
  if (!job) {
    throw new Error(`applyImportBatch: jobId ${jobId} not found`);
  }
  if (!job.projectIntegrationLinkId) {
    throw new Error(
      `applyImportBatch: job ${jobId} is not an integration import (no projectIntegrationLinkId)`,
    );
  }
  const link = await ctx.db.get(job.projectIntegrationLinkId);
  if (!link) {
    throw new Error(
      `applyImportBatch: projectIntegrationLink ${job.projectIntegrationLinkId} not found`,
    );
  }

  for (const [i, event] of events.entries()) {
    const taskNumber = job.numberRangeStart + args.batchStartIndex + i;
    await applyNormalizedEvent(ctx, {
      event,
      link,
      importContext: { taskNumber, importJobId: jobId },
    });
  }

  await ctx.db.patch(jobId, {
    processedRows: job.processedRows + events.length,
  });
}

/**
 * Pure filter helper. Applied by the provider drain action before passing
 * events into `applyImportBatch`. Kept pure so unit tests can lock the
 * filter rules without DB setup.
 */
export function filterImportEvents(
  events: NormalizedIssueEvent[],
  config: ImportFilterConfig,
): NormalizedIssueEvent[] {
  return events.filter((event) => {
    if (!config.includeClosed && event.kind === "issue.closed") return false;
    return true;
  });
}
