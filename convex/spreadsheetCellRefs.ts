import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeCellRef, isValidCellRef, exceedsMaxCells } from "@shared/cellRef";
import { checkResourceMember, requireResourceMember, requireUser } from "./authHelpers";

/**
 * Get cached cell values for a (spreadsheetId, cellRef) pair.
 * Access check: workspace membership (same model as spreadsheets.get).
 */
export const getCellRef = query({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
  },
  returns: v.union(
    v.object({ values: v.array(v.array(v.string())), updatedAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx, { spreadsheetId, cellRef }) => {
    const auth = await checkResourceMember(ctx, "spreadsheets", spreadsheetId);
    if (!auth) return null;

    const ref = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_cellRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("cellRef", normalizeCellRef(cellRef)),
      )
      .unique();

    if (!ref) return null;
    return { values: JSON.parse(ref.values) as string[][], updatedAt: ref.updatedAt };
  },
});

/**
 * List all cell refs tracked for a spreadsheet (for highlighting in the grid).
 * Access check: workspace membership (consistent with spreadsheets.get).
 */
export const listBySpreadsheet = query({
  args: { spreadsheetId: v.id("spreadsheets") },
  returns: v.array(v.object({ cellRef: v.string() })),
  handler: async (ctx, { spreadsheetId }) => {
    const auth = await checkResourceMember(ctx, "spreadsheets", spreadsheetId);
    if (!auth) return [];

    const refs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", spreadsheetId))
      .collect();
    return refs.map((r) => ({ cellRef: r.cellRef }));
  },
});

/**
 * Create a placeholder cache entry when a user inserts a cell reference.
 * If the entry already exists, this is a no-op.
 */
export const ensureCellRef = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, cellRef }) => {
    await requireResourceMember(ctx, "spreadsheets", spreadsheetId);

    const normalized = normalizeCellRef(cellRef);
    if (!isValidCellRef(normalized)) throw new ConvexError("Invalid cell reference");
    if (exceedsMaxCells(normalized)) throw new ConvexError("Range too large (max 100 cells)");

    const existing = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_cellRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("cellRef", normalized),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("spreadsheetCellRefs", {
        spreadsheetId,
        cellRef: normalized,
        values: JSON.stringify([[""]]),
        updatedAt: Date.now(),
      });
      // Schedule snapshot read to populate actual values immediately
      await ctx.scheduler.runAfter(0, internal.spreadsheetCellRefsNode.populateFromSnapshot, {
        spreadsheetId,
        cellRef: normalized,
      });
    }

    return null;
  },
});

/**
 * Batch upsert cell values from PartyKit.
 * Dirty-checks: only patches if values string actually differs.
 */
export const upsertCellValues = internalMutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    updates: v.array(
      v.object({
        cellRef: v.string(),
        values: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, updates }) => {
    for (const { cellRef, values } of updates) {
      const normalized = normalizeCellRef(cellRef);
      const existing = await ctx.db
        .query("spreadsheetCellRefs")
        .withIndex("by_spreadsheet_cellRef", (q) =>
          q.eq("spreadsheetId", spreadsheetId).eq("cellRef", normalized),
        )
        .unique();

      if (existing) {
        // Dirty check: only update if values actually changed
        if (existing.values !== values) {
          await ctx.db.patch(existing._id, { values, updatedAt: Date.now() });
        }
      }
      // Don't create new entries from PartyKit -- only update existing ones
      // created by ensureCellRef. This prevents unbounded growth.
    }
    return null;
  },
});

/**
 * Remove a cached cell ref entry.
 * Called when the inline content is deleted from a document.
 */
export const removeCellRef = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, cellRef }) => {
    await requireUser(ctx);

    const normalized = normalizeCellRef(cellRef);
    const existing = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_cellRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("cellRef", normalized),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});

/**
 * Get all tracked cell refs for a spreadsheet.
 * Used by PartyKit to know which cells to monitor.
 */
export const getReferencedCellRefs = internalQuery({
  args: { spreadsheetId: v.id("spreadsheets") },
  returns: v.array(v.object({ cellRef: v.string() })),
  handler: async (ctx, { spreadsheetId }) => {
    const refs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", spreadsheetId))
      .collect();
    return refs.map((r) => ({ cellRef: r.cellRef }));
  },
});

/**
 * Get a spreadsheet by ID without auth checks.
 * Used internally by populateFromSnapshot action (already auth-gated by ensureCellRef).
 */
export const getSpreadsheetInternal = internalQuery({
  args: { id: v.id("spreadsheets") },
  returns: v.union(
    v.object({
      _id: v.id("spreadsheets"),
      _creationTime: v.number(),
      workspaceId: v.id("workspaces"),
      name: v.string(),
      tags: v.optional(v.array(v.string())),
      yjsSnapshotId: v.optional(v.id("_storage")),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});
