/**
 * Cascade reconciliation — finds and cleans up rows orphaned by failed cascade
 * deletes. A cascade can fail mid-batch (see `convex-cascading-delete` +
 * `_batchCascadeOnComplete` in cascadeDelete.ts which logs `severity: "error"`
 * to the audit log). When that happens some child rows may be left behind.
 *
 * **Alerting (Part A)** — set up a Convex dashboard alert matching audit log
 * entries with `action LIKE "%.cascade_deleted" AND severity = "error"`. That
 * tells you *when* a cascade has failed in prod.
 *
 * **Reconciliation (Part B)** — this module. Call from the Convex dashboard,
 * the CLI (`npx convex run reconciliation:orphanReport`), or a dev REPL.
 *
 * Usage:
 *   npx convex run reconciliation:orphanReport
 *   npx convex run reconciliation:deleteOrphans '{"childTable":"channelMembers","parentField":"channelId"}'
 *
 * Scans are capped at SCAN_LIMIT rows per relationship to stay within Convex
 * query limits. `truncated: true` means the table has more rows than the cap;
 * in that case run `deleteOrphans` repeatedly until `remaining` is false.
 *
 * NOTE: polymorphic tables (edges, nodes, favorites, recentActivity) are not
 * covered here yet — they reference parents via `resourceType + resourceId` /
 * `sourceType + sourceId`. Add cases to this file when needed.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const SCAN_LIMIT = 2048;

/** All foreign-key relationships that the cascade system is expected to keep clean. */
const RELATIONSHIPS = [
  { child: "tasks", field: "projectId", parent: "projects" },
  { child: "taskStatuses", field: "projectId", parent: "projects" },
  { child: "cycles", field: "projectId", parent: "projects" },
  { child: "projectNotificationPreferences", field: "projectId", parent: "projects" },
  { child: "cycleTasks", field: "taskId", parent: "tasks" },
  { child: "cycleTasks", field: "cycleId", parent: "cycles" },
  { child: "cycleTasks", field: "projectId", parent: "projects" },
  { child: "taskComments", field: "taskId", parent: "tasks" },
  { child: "messages", field: "channelId", parent: "channels" },
  { child: "channelMembers", field: "channelId", parent: "channels" },
  { child: "channelNotificationPreferences", field: "channelId", parent: "channels" },
  { child: "callSessions", field: "channelId", parent: "channels" },
  { child: "messageReactions", field: "messageId", parent: "messages" },
  { child: "documentBlockRefs", field: "documentId", parent: "documents" },
  { child: "spreadsheetCellRefs", field: "spreadsheetId", parent: "spreadsheets" },
] as const;

export const orphanReport = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      relationship: v.string(),
      orphanCount: v.number(),
      scannedCount: v.number(),
      truncated: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const results: Array<{
      relationship: string;
      orphanCount: number;
      scannedCount: number;
      truncated: boolean;
    }> = [];

    for (const rel of RELATIONSHIPS) {
      // `any` cast: `rel.child` is a string literal union from the const array,
      // but ctx.db.query's generic can't narrow through a for-of loop variable.
      const rows: Array<{ _id: string; [key: string]: unknown }> = await (
        ctx.db.query as (t: string) => { take: (n: number) => Promise<Array<{ _id: string; [key: string]: unknown }>> }
      )(rel.child).take(SCAN_LIMIT + 1);

      const truncated = rows.length > SCAN_LIMIT;
      const toCheck = rows.slice(0, SCAN_LIMIT);

      let orphanCount = 0;
      for (const row of toCheck) {
        const parentId = row[rel.field];
        if (!parentId) continue;
        const parent = await ctx.db.get(parentId as Id<"channels">);
        if (!parent) orphanCount++;
      }

      results.push({
        relationship: `${rel.child}.${rel.field} → ${rel.parent}`,
        orphanCount,
        scannedCount: toCheck.length,
        truncated,
      });
    }

    return results;
  },
});

export const deleteOrphans = internalMutation({
  args: {
    childTable: v.string(),
    parentField: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    remaining: v.boolean(),
  }),
  handler: async (ctx, { childTable, parentField, batchSize }) => {
    const cap = batchSize ?? 200;

    const rel = RELATIONSHIPS.find(
      (r) => r.child === childTable && r.field === parentField,
    );
    if (!rel) {
      throw new Error(
        `Unknown relationship ${childTable}.${parentField}. See RELATIONSHIPS in reconciliation.ts.`,
      );
    }

    const rows: Array<{ _id: Id<"channelMembers">; [key: string]: unknown }> = await (
      ctx.db.query as (t: string) => { take: (n: number) => Promise<Array<{ _id: Id<"channelMembers">; [key: string]: unknown }>> }
    )(childTable).take(cap + 1);

    const remaining = rows.length > cap;
    const toCheck = rows.slice(0, cap);

    let deleted = 0;
    for (const row of toCheck) {
      const parentId = row[parentField];
      if (!parentId) continue;
      const parent = await ctx.db.get(parentId as Id<"channels">);
      if (!parent) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    return { deleted, scanned: toCheck.length, remaining };
  },
});
