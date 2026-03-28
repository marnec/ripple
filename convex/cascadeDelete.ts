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

// ── Audit log hook ─────────────────────────────────────────────────────
// Logs the full cascade summary to the audit log when a cascade completes.

import { auditLog } from "./auditLog";
import type { DeletionSummary } from "convex-cascading-delete";

export function logCascadeSummary(opts: {
  userId: Id<"users">;
  resourceType: string;
  resourceId: string;
  scope: string;
}) {
  return async (ctx: MutationCtx, summary: DeletionSummary) => {
    await auditLog.log(ctx, {
      action: `${opts.resourceType}.cascade_deleted`,
      actorId: opts.userId,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      severity: "warning",
      metadata: summary,
      scope: opts.scope,
    });
  };
}

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
