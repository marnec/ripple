/**
 * When an import job stops counting as one.
 *
 * `taskImportJobs` rows are created `queued` and moved only by the code that
 * drains them, so a drain that dies leaves a row that looks busy forever. That
 * is not a cosmetic problem: `queued` and `running` are what the concurrency
 * guard in `taskImports.createImportJob` and the active-import banner
 * (`getActiveJobForProject`) both read, so one dead job took the project's
 * import feature with it and nothing in the backend could move it back.
 *
 * The escape is a liveness check rather than a deadline. Every unit of work an
 * import does — a GitHub page applied, a CSV row created or failed — stamps
 * `lastProgressAt`, so the question is "has anything happened lately", not
 * "has this been running a long time". A 1,000-issue import turning twenty
 * pages stays alive throughout; a job whose drain died goes quiet immediately.
 *
 * Rows written before `lastProgressAt` existed fall back to `_creationTime`,
 * which is what lets a row already wedged in production clear itself the first
 * time anything reads it after this ships.
 */

/**
 * How long an active job may go without progress before it is presumed dead.
 *
 * Generous on purpose: the cost of waiting is a disabled Import button, while
 * the cost of expiring a live job is two drains writing over one pre-allocated
 * task-number range. Every real gap here is one HTTP page or one row insert.
 */
export const IMPORT_STALE_AFTER_MS = 15 * 60 * 1000;

/** The job shape this reads — kept structural so both callers and tests fit. */
export interface ImportJobLiveness {
  _creationTime: number;
  lastProgressAt?: number;
}

/**
 * Whether a `queued`/`running` job has gone quiet long enough to be presumed
 * dead. Says nothing about terminal jobs — callers check status first.
 */
export function isImportJobStale(
  job: ImportJobLiveness,
  now: number = Date.now(),
): boolean {
  return now - (job.lastProgressAt ?? job._creationTime) > IMPORT_STALE_AFTER_MS;
}
