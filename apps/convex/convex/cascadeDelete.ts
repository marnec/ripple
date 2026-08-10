import { v } from "convex/values";
import { internalMutation } from "./functions";
import { components } from "./_generated/api";
import {
  CascadingDelete,
  defineCascadeRules,
  makeBatchDeleteHandler,
} from "convex-cascading-delete";
import { triggers } from "./dbTriggers";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";

// The cascade component passes IDs as plain strings. This helper narrows
// to a branded Id<TableNames>, which the trigger-aware writer requires.
// Safe because the ID originates from ctx.db queries inside the component.
function asId(id: string): Id<TableNames> {
  return id as Id<TableNames>;
}

// ── Cascade rules ──────────────────────────────────────────────────────
// Defines the full deletion graph. Triggers only handle insert/update sync
// and aggregate counts; all delete-time cleanup lives here.

export const cascadeRules = defineCascadeRules({
  // ── workspaces ──────────────────────────────────────────────────────
  // Root for full workspace deletion (admin/workspaces.remove). Lists only
  // the DIRECT workspace children — the lib recurses into each child's own
  // rules (channels→messages, projects→tasks, …) and dedupes shared rows via
  // a visited set, so polymorphic tables reached both here and via a resource
  // (edges/nodes/favorites/entityTags/recentActivity/notificationSubscriptions)
  // are safe to also list for sweeping any workspace-level stragglers.
  workspaces: [
    { to: "channels", via: "by_workspace", field: "workspaceId" },
    { to: "projects", via: "by_workspace", field: "workspaceId" },
    { to: "documents", via: "by_workspace", field: "workspaceId" },
    { to: "diagrams", via: "by_workspace", field: "workspaceId" },
    { to: "spreadsheets", via: "by_workspace", field: "workspaceId" },
    { to: "calendarEvents", via: "by_workspace_starts", field: "workspaceId" },
    { to: "workspaceMembers", via: "by_workspace", field: "workspaceId" },
    { to: "workspaceInvites", via: "by_workspace", field: "workspaceId" },
    { to: "workspaceIntegrations", via: "by_workspace", field: "workspaceId" },
    { to: "workspaceMemberExternalIdentity", via: "by_workspace_provider_login", field: "workspaceId" },
    { to: "workspaceEntitlements", via: "by_workspace_feature", field: "workspaceId" },
    { to: "integrationInstallStates", via: "by_workspace", field: "workspaceId" },
    { to: "projectIntegrationLinks", via: "by_workspace", field: "workspaceId" },
    { to: "pullRequests", via: "by_workspace", field: "workspaceId" },
    { to: "tags", via: "by_workspace", field: "workspaceId" },
    { to: "medias", via: "by_workspace", field: "workspaceId" },
    { to: "favorites", via: "by_workspace_user", field: "workspaceId" },
    { to: "entityTags", via: "by_workspace_tag", field: "workspaceId" },
    { to: "recentActivity", via: "by_workspace", field: "workspaceId" },
    // scope holds the workspace id for workspace-scoped subscriptions (channel-
    // scoped ones are already removed via the channel cascade above).
    { to: "notificationSubscriptions", via: "by_scope_category", field: "scope" },
    { to: "nodes", via: "by_workspace", field: "workspaceId" },
    { to: "edges", via: "by_workspace", field: "workspaceId" },
  ],

  // ── projects ────────────────────────────────────────────────────────
  projects: [
    { to: "tasks", via: "by_project", field: "projectId" },
    { to: "taskStatuses", via: "by_project", field: "projectId" },
    { to: "cycles", via: "by_project", field: "projectId" },
    { to: "taskImportJobs", via: "by_project", field: "projectId" },
    { to: "projectNotificationPreferences", via: "by_project", field: "projectId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
  ],

  // ── tasks ───────────────────────────────────────────────────────────
  tasks: [
    { to: "cycleTasks", via: "by_task", field: "taskId" },
    { to: "taskComments", via: "by_task", field: "taskId" },
    { to: "taskPullRequestLinks", via: "by_task", field: "taskId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
    { to: "taskTags", via: "by_task", field: "taskId" },
    { to: "taskExternalRefs", via: "by_task", field: "taskId" },
  ],

  cycles: [
    { to: "cycleTasks", via: "by_cycle", field: "cycleId" },
  ],

  // ── calendarEvents ──────────────────────────────────────────────────
  // When a calendar event is deleted, drop its invitee rows and any
  // guest share rows pointing at it. Channel deletion does NOT cascade
  // here — events tied to a deleted channel survive as standalone (the
  // read path tolerates a missing channelId). Events also participate in
  // the polymorphic graph (nodes/edges) and tag system (entityTags), so
  // those are cascaded too — same shape as documents/diagrams.
  calendarEvents: [
    { to: "calendarEventInvitees", via: "by_event", field: "eventId" },
    { to: "resourceShares", via: "by_resource_id", field: "resourceId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
  ],

  // ── channels ────────────────────────────────────────────────────────
  channels: [
    { to: "messages", via: "by_channel", field: "channelId" },
    { to: "channelMembers", via: "by_channel", field: "channelId" },
    { to: "channelJoinRequests", via: "by_channel_status", field: "channelId" },
    { to: "channelNotificationPreferences", via: "by_channel", field: "channelId" },
    { to: "userChannelState", via: "by_channel_user", field: "channelId" },
    { to: "notificationSubscriptions", via: "by_scope_category", field: "scope" },
    { to: "callSessions", via: "by_channel_active", field: "channelId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
    { to: "resourceShares", via: "by_resource_id", field: "resourceId" },
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
    { to: "resourceShares", via: "by_resource_id", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
  ],

  // ── diagrams ────────────────────────────────────────────────────────
  diagrams: [
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
    { to: "resourceShares", via: "by_resource_id", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
  ],

  // ── spreadsheets ────────────────────────────────────────────────────
  spreadsheets: [
    { to: "spreadsheetCellRefs", via: "by_spreadsheet", field: "spreadsheetId" },
    { to: "edges", via: "by_source", field: "sourceId" },
    { to: "edges", via: "by_target", field: "targetId" },
    { to: "nodes", via: "by_resource", field: "resourceId" },
    { to: "favorites", via: "by_resource_id", field: "resourceId" },
    { to: "recentActivity", via: "by_resource_id", field: "resourceId" },
    { to: "resourceShares", via: "by_resource_id", field: "resourceId" },
    { to: "entityTags", via: "by_resource_id", field: "resourceId" },
  ],
});

// ── Custom deleters ────────────────────────────────────────────────────
// One concern: yjsSnapshotId blob cleanup. The aggregate triggers fire off
// the plain `ctx.db.delete` (see functions.ts); edge/node cleanup is handled
// by the cascade rules above.

type SnapshotDoc = Pick<Doc<"tasks">, "yjsSnapshotId">;

async function deleteWithTriggers(ctx: MutationCtx, id: string) {
  await ctx.db.delete(asId(id));
}

async function deleteWithSnapshotCleanup(ctx: MutationCtx, id: string, doc: SnapshotDoc) {
  if (doc.yjsSnapshotId) await ctx.storage.delete(doc.yjsSnapshotId);
  await deleteWithTriggers(ctx, id);
}

/** Media rows own a `_storage` blob; drop it before deleting the row. */
async function deleteMediaWithBlob(ctx: MutationCtx, id: string, doc: SnapshotDoc) {
  const storageId = (doc as unknown as { storageId?: Id<"_storage"> }).storageId;
  if (storageId) await ctx.storage.delete(storageId);
  await deleteWithTriggers(ctx, id);
}

const deleters: Record<string, (ctx: MutationCtx, id: string, doc: SnapshotDoc) => Promise<void>> = {
  tasks: deleteWithSnapshotCleanup,
  documents: deleteWithSnapshotCleanup,
  diagrams: deleteWithSnapshotCleanup,
  spreadsheets: deleteWithSnapshotCleanup,
  projects: (ctx, id) => deleteWithTriggers(ctx, id),
  channels: (ctx, id) => deleteWithTriggers(ctx, id),
  calendarEvents: (ctx, id) => deleteWithTriggers(ctx, id),
  medias: deleteMediaWithBlob,
  workspaces: (ctx, id) => deleteWithTriggers(ctx, id),
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
