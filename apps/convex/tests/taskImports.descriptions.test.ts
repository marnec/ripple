import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { api, internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";

/**
 * The CSV `description` column. A task description is a Yjs document, not a
 * field, so the import converts each batch's markdown in a Node step and the
 * tasks are inserted already pointing at their snapshot. These pin that the
 * text actually lands, that a file or stored row without the column still
 * imports, and that no converted blob is left behind unreferenced.
 */

/** Rows whose markdown contains this throw in the conversion step. */
const POISON = "<<poison>>";

vi.mock("../convex/lib/headlessEditor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/headlessEditor")>();
  return {
    ...actual,
    markdownToYjsUpdate: async (markdown: string) => {
      if (markdown.includes(POISON)) throw new Error("injected conversion failure");
      return actual.markdownToYjsUpdate(markdown);
    },
  };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setupProject(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Import Project",
      color: "bg-blue-500",
      workspaceId: opts.workspaceId,
      creatorId: opts.userId,
      key: "IMP",
      taskCounter: 0,
    });
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return projectId;
  });
}

const csvRow = (title: string, description?: string) => ({
  title,
  priority: "medium",
  tags: "",
  dueDate: "",
  plannedStartDate: "",
  estimate: "",
  ...(description === undefined ? {} : { description }),
});

async function tasksByTitle(
  t: ReturnType<typeof createTestContext>,
  jobId: Id<"taskImportJobs">,
) {
  const tasks = await t.run(async (ctx) =>
    ctx.db
      .query("tasks")
      .withIndex("by_importJob", (q) => q.eq("importJobId", jobId))
      .collect(),
  );
  return Object.fromEntries(tasks.map((task) => [task.title, task]));
}

/** The plain text of a stored description snapshot, as the editor would load it. */
async function descriptionText(
  t: ReturnType<typeof createTestContext>,
  storageId: Id<"_storage">,
) {
  // Bytes cross `t.run` as an ArrayBuffer — a Uint8Array is not a Convex value.
  const buffer = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(storageId);
    return blob ? await blob.arrayBuffer() : null;
  });
  if (!buffer) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buffer));
  return doc.getXmlFragment(DOCUMENT_FRAGMENT).toString();
}

async function storedBlobCount(t: ReturnType<typeof createTestContext>) {
  return t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
}

async function runJob(
  t: ReturnType<typeof createTestContext>,
  asUser: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"],
  projectId: Id<"projects">,
  workspaceId: Id<"workspaces">,
  rows: Record<string, string>[],
) {
  const jobId = await asUser.mutation(api.taskImports.createImportJob, {
    projectId,
    workspaceId,
    rows,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return jobId;
}

describe("task import descriptions", () => {
  it("creates each task already holding its description", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, userId });

    const jobId = await runJob(t, asUser, projectId, workspaceId, [
      csvRow("With", "Fix the **login** flow\n\n- step one\n- step two"),
      csvRow("Blank", "   "),
      csvRow("Without", ""),
    ]);

    const tasks = await tasksByTitle(t, jobId);
    expect(Object.keys(tasks).sort()).toEqual(["Blank", "With", "Without"]);

    const text = await descriptionText(t, tasks.With.yjsSnapshotId!);
    expect(text).toContain("login");
    expect(text).toContain("step two");

    expect(tasks.Blank.yjsSnapshotId).toBeUndefined();
    expect(tasks.Without.yjsSnapshotId).toBeUndefined();
    expect(await storedBlobCount(t)).toBe(1);
  });

  it("still imports a file written before the column existed", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, userId });

    const jobId = await runJob(t, asUser, projectId, workspaceId, [
      csvRow("Legacy A"),
      csvRow("Legacy B"),
    ]);

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "completed",
      failedRows: 0,
    });
    expect(Object.keys(await tasksByTitle(t, jobId)).sort()).toEqual([
      "Legacy A",
      "Legacy B",
    ]);
  });

  // A job queued by the previous deploy stored rows with no `description`
  // key; the batch's output-schema re-check must still accept them.
  it("imports rows stored before the column existed", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, userId });

    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: [
          {
            title: "Old row",
            priority: "medium",
            tags: null,
            dueDate: null,
            plannedStartDate: null,
            estimate: null,
          },
        ],
        numberRangeStart: 1,
        totalRows: 1,
        processedRows: 0,
        failedRows: 0,
      }),
    );
    await t.action(internal.taskImports.runImport, { jobId });

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "completed",
      failedRows: 0,
    });
  });

  it("imports the task without a description when its markdown fails to convert", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, userId });

    const jobId = await runJob(t, asUser, projectId, workspaceId, [
      csvRow("Broken", `bad ${POISON}`),
      csvRow("Fine", "ok"),
    ]);

    const tasks = await tasksByTitle(t, jobId);
    expect(tasks.Broken.yjsSnapshotId).toBeUndefined();
    expect(await descriptionText(t, tasks.Fine.yjsSnapshotId!)).toContain("ok");
    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      failedRows: 0,
    });
  });

  it("deletes the blob of a row that fails, instead of orphaning it", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, userId });

    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "running",
        // Row 0 fails the stored-row re-check (empty title).
        rows: [
          { title: "", priority: "medium", tags: null, dueDate: null, plannedStartDate: null, estimate: null, description: "x" },
          { title: "Good", priority: "medium", tags: null, dueDate: null, plannedStartDate: null, estimate: null, description: "y" },
        ],
        numberRangeStart: 1,
        totalRows: 2,
        processedRows: 0,
        failedRows: 0,
      }),
    );
    const [bad, good] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["bad"])),
      await ctx.storage.store(new Blob(["good"])),
    ]);

    await t.mutation(internal.taskImports.createImportedTasks, {
      jobId,
      startIndex: 0,
      count: 2,
      descriptionSnapshots: [
        { rowIndex: 0, storageId: bad },
        { rowIndex: 1, storageId: good },
      ],
    });

    const tasks = await tasksByTitle(t, jobId);
    expect(tasks.Good.yjsSnapshotId).toBe(good);
    expect(await t.run(async (ctx) => ctx.storage.get(bad))).toBeNull();
    expect(await storedBlobCount(t)).toBe(1);
  });
});
