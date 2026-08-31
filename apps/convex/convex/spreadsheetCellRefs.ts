import { ConvexError, v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import {
  normalizeCellRef,
  isValidCellRef,
  exceedsMaxCells,
  parseRange,
} from "@ripple/shared/cellRef";
import { checkResourceMember, requireResourceMember, requireUser } from "./authHelpers";

/**
 * Get cached cell values for a (spreadsheetId, stableRef) pair.
 * The cache row's `cellRef` field carries the live A1 (updated by partykit
 * on every push) for tooltip display.
 */
export const getCellRef = query({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    stableRef: v.string(),
  },
  returns: v.union(
    v.object({
      values: v.array(v.array(v.string())),
      updatedAt: v.number(),
      cellRef: v.string(),
      stableRef: v.string(),
      orphan: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, { spreadsheetId, stableRef }) => {
    const auth = await checkResourceMember(ctx, "spreadsheets", spreadsheetId);
    if (!auth) return null;

    const ref = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_stableRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("stableRef", stableRef),
      )
      .unique();

    if (!ref) return null;
    return {
      values: JSON.parse(ref.values) as string[][],
      updatedAt: ref.updatedAt,
      cellRef: ref.cellRef,
      stableRef: ref.stableRef,
      orphan: ref.orphan,
    };
  },
});

/**
 * List all cell refs tracked for a spreadsheet (for highlighting in the grid).
 * Access check: workspace membership (consistent with spreadsheets.get).
 */
export const listBySpreadsheet = query({
  args: { spreadsheetId: v.id("spreadsheets") },
  returns: v.array(
    v.object({
      cellRef: v.string(),
      stableRef: v.string(),
      orphan: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, { spreadsheetId }) => {
    const auth = await checkResourceMember(ctx, "spreadsheets", spreadsheetId);
    if (!auth) return [];

    const refs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", spreadsheetId))
      .collect();
    return refs.map((r) => ({
      cellRef: r.cellRef,
      stableRef: r.stableRef,
      orphan: r.orphan,
    }));
  },
});

/**
 * Create the cache entry when a user inserts a cell reference.
 * Dedupes by stableRef. Schedules `populateFromSnapshot` to settle `values`.
 *
 * `values` is what the inserting client read out of its own replica of the
 * room a moment earlier, and it is the whole point of the argument: without it
 * the row starts blank and every reader — the author included — watches the
 * embed sit empty until a Node action has fetched and decoded the snapshot.
 * The scheduled populate still runs and still wins, so a client that sends
 * something wrong is corrected within the second; treating the seed as
 * authoritative is what we must not do, not accepting it.
 */
export const ensureCellRef = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
    stableRef: v.string(),
    /** Display values the client read at insert time, row-major. */
    values: v.optional(v.array(v.array(v.string()))),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, cellRef, stableRef, values }) => {
    await requireResourceMember(ctx, "spreadsheets", spreadsheetId);

    const normalized = normalizeCellRef(cellRef);
    if (!isValidCellRef(normalized)) throw new ConvexError("Invalid cell reference");
    if (exceedsMaxCells(normalized)) throw new ConvexError("Range too large (max 100 cells)");

    const existing = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_stableRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("stableRef", stableRef),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("spreadsheetCellRefs", {
        spreadsheetId,
        cellRef: normalized,
        stableRef,
        values: JSON.stringify(seedValues(values, normalized)),
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.spreadsheetCellRefsNode.populateFromSnapshot, {
        spreadsheetId,
        stableRef,
      });
    }

    return null;
  },
});

/**
 * The seed grid to store, or the blank placeholder when there is nothing
 * usable. A seed is accepted only when it is no bigger than the range it
 * claims to be — the ref itself is already capped at 100 cells, and a grid
 * that disagrees with its own ref is not a grid we would ever display.
 */
function seedValues(
  values: string[][] | undefined,
  normalizedRef: string,
): string[][] {
  if (!values || values.length === 0) return [[""]];
  const range = parseRange(normalizedRef);
  const maxRows = range ? range.endRow - range.startRow + 1 : 1;
  const maxCols = range ? range.endCol - range.startCol + 1 : 1;
  if (values.length > maxRows) return [[""]];
  if (values.some((row) => row.length > maxCols)) return [[""]];
  return values;
}

/**
 * Batch upsert cell values from PartyKit. Each update carries the row's
 * stableRef + the live A1 derived from it. `cellRef` on the cache row is
 * updated in place to track the live A1 for tooltip display.
 */
export const upsertCellValues = internalMutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    updates: v.array(
      v.object({
        stableRef: v.string(),
        liveCellRef: v.optional(v.string()),
        values: v.string(),
        orphan: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, updates }) => {
    for (const { stableRef, liveCellRef, values, orphan } of updates) {
      const existing = await ctx.db
        .query("spreadsheetCellRefs")
        .withIndex("by_spreadsheet_stableRef", (q) =>
          q.eq("spreadsheetId", spreadsheetId).eq("stableRef", stableRef),
        )
        .unique();

      if (existing) {
        const nextCellRef = liveCellRef ?? existing.cellRef;
        const valuesChanged = existing.values !== values;
        const cellRefChanged = existing.cellRef !== nextCellRef;
        const orphanChanged = (existing.orphan ?? false) !== (orphan ?? false);
        if (valuesChanged || cellRefChanged || orphanChanged) {
          await ctx.db.patch(existing._id, {
            values,
            cellRef: nextCellRef,
            orphan,
            updatedAt: Date.now(),
          });
        }
      }
      // Don't create new entries from PartyKit -- only update existing ones
      // created by ensureCellRef. Prevents unbounded growth.
    }
    return null;
  },
});

/**
 * Remove a cached cell ref entry. Called when the inline content / block is
 * deleted from a document.
 */
export const removeCellRef = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    stableRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, stableRef }) => {
    // The workspace rule, matching `ensureCellRef` above.
    await requireResourceMember(ctx, "spreadsheets", spreadsheetId);

    const existing = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet_stableRef", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("stableRef", stableRef),
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
  returns: v.array(
    v.object({
      cellRef: v.string(),
      stableRef: v.string(),
    }),
  ),
  handler: async (ctx, { spreadsheetId }) => {
    const refs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", spreadsheetId))
      .collect();
    return refs.map((r) => ({ cellRef: r.cellRef, stableRef: r.stableRef }));
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
