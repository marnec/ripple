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

/** Phase-1 schema: validate the whole array in one pass. */
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
 */
export const taskImportRowOutputSchema = z.object({
  title: z.string().min(1),
  priority: z.enum(PRIORITY_VALUES).nullable(),
  tags: z.array(z.string()).nullable(),
  dueDate: z.string().nullable(),
  plannedStartDate: z.string().nullable(),
  estimate: z.number().positive().nullable(),
});

/**
 * Soft cap on the JSON payload size sent to the createImportJob mutation.
 * Convex's hard document-size limit is 1 MB; we leave headroom for the
 * other job fields and JSON escape inflation.
 */
export const TASK_IMPORT_MAX_PAYLOAD_BYTES = 900_000;
