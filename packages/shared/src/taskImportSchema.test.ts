import { describe, expect, it } from "vitest";

import {
  TASK_IMPORT_EXAMPLE_ROW,
  TASK_IMPORT_HEADERS,
  buildTaskImportTemplateCsv,
  isTaskImportExampleRow,
  stripTaskImportExampleRows,
  taskImportRowOutputSchema,
  taskImportRowSchema,
  taskImportRowsSchema,
} from "./taskImportSchema";

/** A row exactly as papaparse yields it: every cell a string. */
const csvRow = (overrides: Record<string, string> = {}) => ({
  title: "Verify the line",
  priority: "urgent",
  tags: "prj2; fornitore ;alimentazione",
  dueDate: "",
  plannedStartDate: "",
  estimate: "",
  ...overrides,
});

describe("taskImportRowSchema", () => {
  it("splits, trims and drops empty tags", () => {
    const row = taskImportRowSchema.parse(csvRow());
    expect(row.tags).toEqual(["prj2", "fornitore", "alimentazione"]);
  });

  it("nulls blank cells and coerces estimate", () => {
    const row = taskImportRowSchema.parse(
      csvRow({ tags: "", priority: "", estimate: "3.5" }),
    );
    expect(row).toMatchObject({
      priority: null,
      tags: null,
      dueDate: null,
      plannedStartDate: null,
      estimate: 3.5,
    });
  });

  // The two schemas are the two ends of the wire: whatever the input schema
  // produces is what gets stored, and the output schema is what re-reads it
  // in createImportedTasks. If they drift, rows validate on the way in and
  // fail per-row on the way out.
  it("produces rows the stored-row schema accepts", () => {
    const rows = taskImportRowsSchema.parse([
      csvRow(),
      csvRow({ tags: "", dueDate: "2026-06-01", estimate: "2" }),
    ]);
    for (const row of rows) {
      expect(taskImportRowOutputSchema.safeParse(row).success).toBe(true);
    }
  });

  // Regression: the client used to send `taskImportRowsSchema`'s output back
  // into the mutation, which re-runs the same schema — every tagged row came
  // back "expected string, received array" after passing validation locally.
  // Rows must reach createImportJob as raw CSV cells.
  it("is not idempotent — rejects its own output", () => {
    const parsed = taskImportRowSchema.parse(csvRow());
    const result = taskImportRowSchema.safeParse(parsed);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("tags");
  });
});

describe("taskImportRowOutputSchema", () => {
  // These messages are what the import job stores on a failed row and the
  // status page shows, so they have to name the column and the expected
  // format — not zod's "expected string, received array".
  it("reports failures in the CSV's own vocabulary", () => {
    const result = taskImportRowOutputSchema.safeParse({
      title: "",
      priority: "asap",
      tags: "design;q3",
      dueDate: null,
      plannedStartDate: null,
      estimate: -2,
    });
    expect(result.success).toBe(false);
    const byField = Object.fromEntries(
      (result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]),
    );
    expect(byField.title).toBe("title is required");
    expect(byField.priority).toMatch(/^priority must be one of: /);
    expect(byField.tags).toBe("tags must be text separated by ;");
    expect(byField.estimate).toBe("estimate must be a positive number");
  });
});

describe("the template's example row", () => {
  it("demonstrates a format the import actually accepts", () => {
    const row = taskImportRowSchema.parse(TASK_IMPORT_EXAMPLE_ROW);
    expect(row).toMatchObject({
      priority: "high",
      tags: ["design", "q3-roadmap"],
      dueDate: "2026-09-30",
      plannedStartDate: "2026-09-15",
      estimate: 3,
    });
  });

  it("is written into the template under the declared headers, in order", () => {
    const [header, example, ...rest] = buildTaskImportTemplateCsv().trim().split("\n");
    expect(header).toBe(TASK_IMPORT_HEADERS.join(","));
    expect(rest).toEqual([]);
    // The title carries a comma, so it has to arrive quoted — otherwise the
    // template we hand out fails its own header-count check.
    expect(example).toContain(`"${TASK_IMPORT_EXAMPLE_ROW.title}"`);
    expect(example).toContain("design;q3-roadmap");
  });

  it("is skipped rather than imported when left in the file", () => {
    const rows = [
      TASK_IMPORT_EXAMPLE_ROW,
      csvRow({ title: "A real task" }),
      { ...TASK_IMPORT_EXAMPLE_ROW, title: "  example: lower case and padded" },
    ];
    expect(stripTaskImportExampleRows(rows)).toEqual([
      csvRow({ title: "A real task" }),
    ]);
  });

  it("imports the example once the marker is removed", () => {
    const edited = {
      ...TASK_IMPORT_EXAMPLE_ROW,
      title: "Ship the roadmap deck",
    };
    expect(isTaskImportExampleRow(edited)).toBe(false);
    expect(stripTaskImportExampleRows([edited])).toEqual([edited]);
  });

  it("ignores rows that merely mention the word", () => {
    expect(isTaskImportExampleRow(csvRow({ title: "Write an example test" }))).toBe(
      false,
    );
    expect(isTaskImportExampleRow(null)).toBe(false);
    expect(isTaskImportExampleRow("EXAMPLE: a string, not a row")).toBe(false);
  });
});
