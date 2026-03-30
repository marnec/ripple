import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import {
  CascadingDelete,
  defineCascadeRules,
  makeBatchDeleteHandler,
} from "convex-cascading-delete";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";

// The cascade component passes IDs as plain strings. This helper narrows
// to a branded Id<TableNames> for writerWithTriggers, which requires it.
// Safe because the ID originates from ctx.db queries inside the component.
function asId(id: string): Id<TableNames> {
  return id as Id<TableNames>;
}

// ── Cascade rules ──────────────────────────────────────────────────────
// Defines the full deletion graph. Triggers only handle insert/update sync
// and aggregate counts; all delete-time cleanup lives here.

export const cascadeRules = defineCascadeRules({
  // ── projects ────────────────────────────────────────────────────────
  projects: [
    { to: "tasks", via: "by_project", field: "projectId" },
    { to: "taskStatuses", via: "by_project", field: "projectId" },
    { to: "cycles", via: "by_project", field: "projectId" },
    { to: "projectNotificationPreferences", via: "by_project", field: "projectId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
  ],

  // ── tasks ───────────────────────────────────────────────────────────
  tasks: [
    { to: "cycleTasks", via: "by_task", field: "taskId" },
    { to: "taskComments", via: "by_task", field: "taskId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
  ],

  cycles: [
    { to: "cycleTasks", via: "by_cycle", field: "cycleId" },
  ],

  // ── channels ────────────────────────────────────────────────────────
  channels: [
    { to: "messages", via: "by_channel", field: "channelId" },
    { to: "channelMembers", via: "by_channel", field: "channelId" },
    { to: "channelNotificationPreferences", via: "by_channel", field: "channelId" },
    { to: "callSessions", via: "by_channel_active", field: "channelId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
  ],

  messages: [
    { to: "messageReactions", via: "by_message", field: "messageId" },
  ],

  // ── documents ───────────────────────────────────────────────────────
  documents: [
    { to: "documentBlockRefs", via: "by_document", field: "documentId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
  ],

  // ── diagrams ────────────────────────────────────────────────────────
  diagrams: [
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
  ],

  // ── spreadsheets ────────────────────────────────────────────────────
  spreadsheets: [
    { to: "spreadsheetCellRefs", via: "by_spreadsheet", field: "spreadsheetId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
  ],
});

// ── Custom deleters ────────────────────────────────────────────────────
// Two concerns: (1) yjsSnapshotId blob cleanup, (2) aggregate triggers via writerWithTriggers.
// Edge/node cleanup is handled by cascade rules above.

type SnapshotDoc = Pick<Doc<"tasks">, "yjsSnapshotId">;

async function deleteWithTriggers(ctx: MutationCtx, id: string) {
  await writerWithTriggers(ctx, ctx.db, triggers).delete(asId(id));
}

async function deleteWithSnapshotCleanup(ctx: MutationCtx, id: string, doc: SnapshotDoc) {
  if (doc.yjsSnapshotId) await ctx.storage.delete(doc.yjsSnapshotId);
  await deleteWithTriggers(ctx, id);
}

const deleters: Record<string, (ctx: MutationCtx, id: string, doc: SnapshotDoc) => Promise<void>> = {
  tasks: deleteWithSnapshotCleanup,
  documents: deleteWithSnapshotCleanup,
  diagrams: deleteWithSnapshotCleanup,
  spreadsheets: deleteWithSnapshotCleanup,
  projects: (ctx, id) => deleteWithTriggers(ctx, id),
  channels: (ctx, id) => deleteWithTriggers(ctx, id),
};

// ── Audit log hooks ───────────────────────────────────────────────────
// Log cascade summary to audit log when a cascade completes.

import { auditLog } from "./auditLog";
import type { DeletionSummary } from "convex-cascading-delete";

/** Inline mode: returns a closure called in the same transaction. */
export function logCascadeSummary(opts: {
  userId: Id<"users">;
  resourceType: string;
  resourceId: string;
  scope: string;
}) {
  return async (ctx: MutationCtx, summary: DeletionSummary) => {
    // Exclude the root table from the cascade summary — it's already
    // logged as the explicit user action (e.g. "deleted task X").
    const { [opts.resourceType]: _, ...cascadedOnly } = summary;
    if (Object.keys(cascadedOnly).length === 0) return;

    await auditLog.log(ctx, {
      action: `${opts.resourceType}.cascade_deleted`,
      actorId: opts.userId,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      severity: "warning",
      metadata: cascadedOnly,
      scope: opts.scope,
    });
  };
}

/**
 * Batched mode: scheduled by the component when all batches complete.
 * Receives { summary, status, context } where context is the JSON-serialized
 * onCompleteContext passed at call time.
 */
export const _batchCascadeOnComplete = internalMutation({
  args: {
    summary: v.string(),
    status: v.string(),
    context: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { summary, status, context }) => {
    if (!context) return null;

    const { userId, resourceType, resourceId, scope } = JSON.parse(context) as {
      userId: string;
      resourceType: string;
      resourceId: string;
      scope: string;
    };

    const { [resourceType]: _, ...cascadedOnly } = JSON.parse(summary) as Record<string, number>;
    if (Object.keys(cascadedOnly).length === 0) return null;

    await auditLog.log(ctx, {
      action: `${resourceType}.cascade_deleted`,
      actorId: userId,
      resourceType,
      resourceId,
      severity: status === "completed" ? "warning" : "error",
      metadata: cascadedOnly,
      scope,
    });

    return null;
  },
});

// ── Exported instances ─────────────────────────────────────────────────

export const cascadeDelete = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules,
  deleters,
});

export const _cascadeBatchHandler = makeBatchDeleteHandler(
  internalMutation,
  components.convexCascadingDelete,
  deleters,
);
