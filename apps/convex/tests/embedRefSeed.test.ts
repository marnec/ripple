import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * `ensureCellRef` / `ensureBlockRef` accept the content the inserting client
 * was already showing, so a fresh embed renders with something in it rather
 * than sitting blank until a Node action has fetched and decoded a snapshot.
 *
 * The seed is provisional by construction — `populateFromSnapshot` is
 * scheduled either way and overwrites it — so what these pin is that it lands,
 * that it never replaces a row the server has already projected, and that a
 * grid disagreeing with its own ref is thrown away rather than stored.
 */

type TestContext = ReturnType<typeof createTestContext>;

async function makeSpreadsheet(t: TestContext, workspaceId: Id<"workspaces">) {
  return await t.run((ctx) =>
    ctx.db.insert("spreadsheets", { workspaceId, name: "Budget" }),
  );
}

async function makeDocument(t: TestContext, workspaceId: Id<"workspaces">) {
  return await t.run((ctx) =>
    ctx.db.insert("documents", { workspaceId, name: "Notes" }),
  );
}

const CELL_STABLE_REF = JSON.stringify({ rowId: "r1", colId: "c1" });
const RANGE_STABLE_REF = JSON.stringify({
  startRowId: "r1",
  startColId: "c1",
  endRowId: "r2",
  endColId: "c2",
});

describe("ensureCellRef — insert-time seed", () => {
  it("stores the values the client read at insert time", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const spreadsheetId = await makeSpreadsheet(t, workspaceId);

    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1",
      stableRef: CELL_STABLE_REF,
      values: [["42"]],
    });

    const ref = await asUser.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef: CELL_STABLE_REF,
    });
    expect(ref?.values).toEqual([["42"]]);
  });

  it("stores a blank placeholder when the client sends nothing", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const spreadsheetId = await makeSpreadsheet(t, workspaceId);

    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1",
      stableRef: CELL_STABLE_REF,
    });

    const ref = await asUser.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef: CELL_STABLE_REF,
    });
    expect(ref?.values).toEqual([[""]]);
  });

  it("keeps a range seed that is clipped shorter than its own ref", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const spreadsheetId = await makeSpreadsheet(t, workspaceId);

    // extractCellValues clips a range that runs past the last row rather than
    // padding it, so fewer rows than the ref describes is normal.
    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1:B2",
      stableRef: RANGE_STABLE_REF,
      values: [["a", "b"]],
    });

    const ref = await asUser.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef: RANGE_STABLE_REF,
    });
    expect(ref?.values).toEqual([["a", "b"]]);
  });

  it("discards a seed bigger than the range it claims to be", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const spreadsheetId = await makeSpreadsheet(t, workspaceId);

    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1",
      stableRef: CELL_STABLE_REF,
      values: [["a", "b"], ["c", "d"]],
    });

    const ref = await asUser.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef: CELL_STABLE_REF,
    });
    expect(ref?.values).toEqual([[""]]);
  });

  it("never overwrites a row the server has already projected", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const spreadsheetId = await makeSpreadsheet(t, workspaceId);

    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1",
      stableRef: CELL_STABLE_REF,
      values: [["42"]],
    });
    // A second insert of the same reference — the live value must win over
    // whatever the second client happened to be holding.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("spreadsheetCellRefs")
        .withIndex("by_spreadsheet_stableRef", (q) =>
          q.eq("spreadsheetId", spreadsheetId).eq("stableRef", CELL_STABLE_REF),
        )
        .unique();
      await ctx.db.patch(row!._id, { values: JSON.stringify([["99"]]) });
    });

    await asUser.mutation(api.spreadsheetCellRefs.ensureCellRef, {
      spreadsheetId,
      cellRef: "A1",
      stableRef: CELL_STABLE_REF,
      values: [["stale"]],
    });

    const ref = await asUser.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef: CELL_STABLE_REF,
    });
    expect(ref?.values).toEqual([["99"]]);
  });
});

describe("ensureBlockRef — insert-time seed", () => {
  it("stores the block content the picker was showing", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await makeDocument(t, workspaceId);

    await asUser.mutation(api.documentBlockRefs.ensureBlockRef, {
      documentId,
      blockId: "block-1",
      blockType: "heading",
      textContent: "Quarterly goals",
    });

    expect(
      await asUser.query(api.documentBlockRefs.getBlockRef, {
        documentId,
        blockId: "block-1",
      }),
    ).toMatchObject({ blockType: "heading", textContent: "Quarterly goals" });
  });

  it("falls back to a paragraph placeholder without a seed", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await makeDocument(t, workspaceId);

    await asUser.mutation(api.documentBlockRefs.ensureBlockRef, {
      documentId,
      blockId: "block-1",
    });

    expect(
      await asUser.query(api.documentBlockRefs.getBlockRef, {
        documentId,
        blockId: "block-1",
      }),
    ).toMatchObject({ blockType: "paragraph", textContent: "" });
  });

  it("ignores a block type that is not embeddable", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await makeDocument(t, workspaceId);

    await asUser.mutation(api.documentBlockRefs.ensureBlockRef, {
      documentId,
      blockId: "block-1",
      blockType: "diagram",
      textContent: "Text",
    });

    expect(
      await asUser.query(api.documentBlockRefs.getBlockRef, {
        documentId,
        blockId: "block-1",
      }),
    ).toMatchObject({ blockType: "paragraph" });
  });
});
