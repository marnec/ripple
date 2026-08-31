import { z } from "zod";
import { TaskPriority } from "./enums/taskPriority";

/**
 * Strict column order for the task-import CSV template.
 *
 * Misordered columns are rejected at parse-time before the rows ever reach the
 * server. The order is also the order the columns appear in the generated
 * template download (see ImportTasksButton).
 */
export const TASK_IMPORT_HEADERS = [
  "title",
  "priority",
  "tags",
  "dueDate",
  "plannedStartDate",
  "estimate",
] as const;

export type TaskImportHeader = (typeof TASK_IMPORT_HEADERS)[number];

const PRIORITY_VALUES = [
  TaskPriority.URGENT,
  TaskPriority.HIGH,
  TaskPriority.MEDIUM,
  TaskPriority.LOW,
] as const;

/**
 * Convert empty / whitespace-only strings to null before downstream schemas
 * run. CSV cells are always strings out of papaparse, so this normalises
 * "" / "  " into a real null that nullable() / optional() schemas can handle.
 */
const toNullIfBlank = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? null : v;

const nullable = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(toNullIfBlank, s.nullable());

/**
 * One CSV row → one task. Only "base" fields are accepted: anything that
 * requires cross-validation (assignee, dependencies) or a nested structure
 * (comments) is excluded from v1. Status is also excluded — the project's
 * default status is applied at create-time.
 *
 * Empty cells become null. Tags are split on `;` and trimmed; an entirely
 * blank cell yields null (no tags), a cell with only separators yields [].
 *
 * Note: the column is "tags" (user-facing terminology), but the underlying
 * task field is still named "labels" — that's the denormalized storage
 * that the central `tags` / `taskTags` tables sync from.
 */
export const taskImportRowSchema = z.object({
  title: z
    .string({ message: "title is required" })
    .trim()
    .min(1, "title is required"),
  priority: nullable(
    z.enum(PRIORITY_VALUES, {
      message: `priority must be one of: ${PRIORITY_VALUES.join(", ")}`,
    }),
  ),
  tags: nullable(
    z
      .string()
      .transform((s) =>
        s
          .split(";")
          .map((l) => l.trim())
          .filter(Boolean),
      ),
  ),
  dueDate: nullable(
    z.iso.date({ message: "dueDate must be a date (YYYY-MM-DD)" }),
  ),
  plannedStartDate: nullable(
    z.iso.date({ message: "plannedStartDate must be a date (YYYY-MM-DD)" }),
  ),
  estimate: nullable(
    z.coerce
      .number({ message: "estimate must be a positive number" })
      .positive("estimate must be a positive number"),
  ),
});

export type TaskImportRow = z.infer<typeof taskImportRowSchema>;

/**
 * Phase-1 schema: validate the whole array in one pass.
 *
 * Takes RAW CSV cells (every value a string) and is NOT idempotent — feeding
 * it its own output rejects each transformed cell (`tags` is the loud one:
 * "expected string, received array"). So the client sends papaparse's rows to
 * `createImportJob` unchanged and lets the server's parse be the one that
 * transforms; `taskImportRowOutputSchema` is what re-checks stored rows.
 */
export const taskImportRowsSchema = z.array(taskImportRowSchema);

/**
 * Shape validation for an *already-parsed* row, i.e. the shape we persist
 * inside taskImportJobs.rows. The input schemas coerce strings → typed
 * values (labels becomes string[], estimate becomes number, blanks become
 * null), so re-running them on stored data would reject those typed values.
 *
 * This schema gives us a cheap structural re-check inside the workpool
 * action's per-row write — it catches the rare case where stored data has
 * been corrupted or the running version's schema is tighter than the one
 * that originally accepted the row.
 *
 * Messages are written for a person, not a developer: they are the ones the
 * import job stores on the failed row and the status page shows. Zod's own
 * wording ("expected string, received array") names a type the user never
 * typed, which is exactly the kind of error this file is trying to stop
 * surfacing.
 */
export const taskImportRowOutputSchema = z.object({
  title: z.string("title is required").min(1, "title is required"),
  priority: z
    .enum(PRIORITY_VALUES, {
      message: `priority must be one of: ${PRIORITY_VALUES.join(", ")}`,
    })
    .nullable(),
  tags: z.array(z.string(), "tags must be text separated by ;").nullable(),
  dueDate: z.string("dueDate must be a date (YYYY-MM-DD)").nullable(),
  plannedStartDate: z
    .string("plannedStartDate must be a date (YYYY-MM-DD)")
    .nullable(),
  estimate: z
    .number("estimate must be a positive number")
    .positive("estimate must be a positive number")
    .nullable(),
});

/**
 * A row's failure, as stored on the import job and rendered on the status
 * page. `row` is 1-based over the CSV's data rows (the header is row 0), the
 * same numbering the pre-import validation dialog uses.
 */
export interface TaskImportRowError {
  row: number;
  field?: string;
  message: string;
}

/**
 * How many row errors a job keeps. The list is a diagnostic, not a ledger:
 * the count of failures is exact (`failedRows`), and the first handful of
 * reasons is what tells someone what to fix — a CSV whose column is wrong
 * throws the same error on every row, so the 500th copy adds nothing and the
 * whole payload has to fit in one Convex document alongside `rows`.
 */
export const TASK_IMPORT_MAX_ROW_ERRORS = 20;

/** Turn a zod issue on a parsed row into a stored, user-facing row error. */
export function toRowError(
  rowNumber: number,
  issue: { path: PropertyKey[]; message: string },
): TaskImportRowError {
  const field = issue.path[0];
  return {
    row: rowNumber,
    ...(typeof field === "string" ? { field } : {}),
    message: issue.message,
  };
}

// ── Template & its example row ─────────────────────────────────────────

/**
 * Marks the example row the downloaded template ships with.
 *
 * The template used to be a bare header line, which says the column *names*
 * but not what goes in them — the formats that actually get rejected (dates,
 * the `;` tag separator, the priority vocabulary) were only discoverable by
 * failing an import. So the template carries one filled-in row instead, and
 * this prefix is what lets the import drop that row if it is still there at
 * upload time: an example that has to be deleted before use is a trap, not a
 * help.
 *
 * Matched case-insensitively on the trimmed title, so a user who edits the
 * example into a real task (the natural thing to do) only has to remove the
 * marker, and a real title starting with these characters is unlikely.
 */
export const TASK_IMPORT_EXAMPLE_PREFIX = "EXAMPLE:";

/**
 * The template's example row — a correct value for every column, in header
 * order. Pinned by a test against `taskImportRowSchema`, so the row we hand
 * people can never demonstrate a format the import rejects.
 */
export const TASK_IMPORT_EXAMPLE_ROW: Record<TaskImportHeader, string> = {
  title: `${TASK_IMPORT_EXAMPLE_PREFIX} delete this row, or drop the ${TASK_IMPORT_EXAMPLE_PREFIX} prefix to import it`,
  priority: "high",
  tags: "design;q3-roadmap",
  dueDate: "2026-09-30",
  plannedStartDate: "2026-09-15",
  estimate: "3",
};

/** True for the template's example row, left in the file at upload time. */
export function isTaskImportExampleRow(row: unknown): boolean {
  if (typeof row !== "object" || row === null) return false;
  const title = (row as Record<string, unknown>).title;
  return (
    typeof title === "string" &&
    title.trim().toLowerCase().startsWith(TASK_IMPORT_EXAMPLE_PREFIX.toLowerCase())
  );
}

/**
 * Drop the template's example row(s). Applied on the client before
 * validation and again in `createImportJob`, so the row is skipped rather
 * than imported as a junk task no matter which one sees it.
 */
export function stripTaskImportExampleRows<T>(rows: T[]): T[] {
  return rows.filter((row) => !isTaskImportExampleRow(row));
}

/** Quote a CSV cell if it contains a separator, quote or newline. */
function csvCell(value: string): string {
  return /[,"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The downloadable template: the header line plus the example row. Built here
 * rather than in the download handler so the cell order cannot drift from
 * `TASK_IMPORT_HEADERS`.
 */
export function buildTaskImportTemplateCsv(): string {
  const header = TASK_IMPORT_HEADERS.join(",");
  const example = TASK_IMPORT_HEADERS.map((h) =>
    csvCell(TASK_IMPORT_EXAMPLE_ROW[h]),
  ).join(",");
  return `${header}\n${example}\n`;
}

/**
 * Soft cap on the JSON payload size sent to the createImportJob mutation.
 * Convex's hard document-size limit is 1 MB; we leave headroom for the
 * other job fields and JSON escape inflation.
 */
export const TASK_IMPORT_MAX_PAYLOAD_BYTES = 900_000;

/**
 * How many of a job's tasks the import status page lists.
 *
 * The list is a live subscription over a range the import is actively writing
 * into, so an unbounded read set grows with the job and is re-read on every
 * batch. A hard cap keeps that cost flat; the page is a progress feed, and the
 * project task list is where the full set is meant to be read.
 *
 * Shared so the client can tell "there are exactly this many" from "this is
 * the most recent slice" without a second round trip.
 */
export const TASK_IMPORT_TASK_LIST_LIMIT = 100;
