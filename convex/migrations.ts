import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel, Id } from "./_generated/dataModel.js";
import { internalMutation } from "./_generated/server.js";
import { v } from "convex/values";
import { auditLog } from "./auditLog.js";
import { extractMessageTargets } from "./utils/blocknote.js";
import {
  BROADCAST_WORKSPACE_CATEGORIES,
  BROADCAST_CHANNEL_CATEGORIES,
  DEFAULT_PREFERENCES,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  type NotificationCategory,
} from "@shared/notificationCategories";

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * Migrate taskStatuses from workspace-scoped to project-scoped.
 *
 * For each old taskStatus that has workspaceId but no projectId:
 * 1. Find all projects in that workspace
 * 2. For each project, create a project-scoped copy (or reuse existing by name)
 * 3. Remap any tasks referencing the old status to the new project-scoped one
 * 4. Delete the old workspace-scoped status
 */
export const migrateTaskStatusesToProject = migrations.define({
  table: "taskStatuses",
  migrateOne: async (ctx, status) => {
    // Already project-scoped — nothing to do
    if (status.projectId) return;

    const legacy = status as Record<string, unknown>;

    // No workspace either — orphaned, just delete
    if (!legacy.workspaceId) {
      await ctx.db.delete(status._id);
      return;
    }

    const workspaceId = legacy.workspaceId as Id<"workspaces">;

    // Find all projects in this workspace
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    for (const project of projects) {
      // Check if this project already has a status with the same name
      const existingStatuses = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      const matchingStatus = existingStatuses.find(
        (s) => s.name === status.name
      );

      let targetStatusId;

      if (matchingStatus) {
        // Project already has a status with this name — use it
        targetStatusId = matchingStatus._id;
      } else {
        // Create a project-scoped copy
        targetStatusId = await ctx.db.insert("taskStatuses", {
          projectId: project._id,
          name: status.name,
          color: status.color,
          order: status.order,
          isDefault: status.isDefault,
          isCompleted: status.isCompleted,
        });
      }

      // Remap any tasks in this project that reference the old status
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", project._id).eq("statusId", status._id)
        )
        .collect();

      for (const task of tasks) {
        await ctx.db.patch(task._id, { statusId: targetStatusId });
      }
    }

    // Delete the old workspace-scoped status
    await ctx.db.delete(status._id);
  },
});

export const run = migrations.runner();

// Runs all migrations in order. Chain with deploy:
// npx convex deploy --cmd 'npm run build' && npx convex run migrations:runAll --prod
export const runAll = migrations.runner([
  internal.migrations.migrateTaskStatusesToProject,
  internal.migrations.stripDeprecatedFields,
  internal.migrations.stripDocumentFields,
  internal.migrations.stripDiagramFields,
  internal.migrations.migrateChannelIsPublicToType,
  internal.migrations.stripChannelRoleCount,
  internal.migrations.stripSpreadsheetFields,
  internal.migrations.backfillDocumentAggregates,
  internal.migrations.backfillDiagramAggregates,
  internal.migrations.backfillSpreadsheetAggregates,
  internal.migrations.backfillProjectAggregates,
  internal.migrations.backfillChannelAggregates,
  internal.migrations.backfillMemberAggregates,
  internal.migrations.backfillTaskAggregates,
  internal.migrations.stripTaskStartDate,
  internal.migrations.backfillDocumentNodes,
  internal.migrations.backfillDiagramNodes,
  internal.migrations.backfillSpreadsheetNodes,
  internal.migrations.backfillProjectNodes,
  internal.migrations.backfillChannelNodes,
  internal.migrations.backfillTaskNodes,
  internal.migrations.stripMessageEdges,
  internal.migrations.stripEdgeGroupId,
  internal.migrations.backfillChannelMentionEdges,
  internal.migrations.backfillTaskBelongsToEdges,
  internal.migrations.backfillUserNodes,
  internal.migrations.backfillEdgeNodeIds,
  internal.migrations.backfillChannelMemberDenormalized,
  internal.migrations.backfillNotificationSubscriptions,
  internal.migrations.backfillDocumentTags,
  internal.migrations.backfillDiagramTags,
  internal.migrations.backfillSpreadsheetTags,
  internal.migrations.backfillTaskTags,
  internal.migrations.migrateTaskEntityTagsToTaskTags,
  internal.migrations.backfillTaskTagsSortFields,
  internal.migrations.backfillTaskTagsAssigneeId,
  internal.migrations.cleanupProjectTagsField,
  internal.migrations.cleanupProjectEntityTags,
]);

/**
 * Strip deprecated fields from existing documents after removing
 * per-resource membership tables.
 *
 * - projects: remove linkedChannelId, memberCount
 * - documents: remove roleCount
 * - diagrams: remove roleCount
 * - spreadsheets: remove roleCount
 *
 * Run from the Convex dashboard after deploying the schema changes.
 */
export const stripDeprecatedFields = migrations.define({
  table: "projects",
  migrateOne: async (ctx, project) => {
    const legacy = project as Record<string, unknown>;
    if (legacy.linkedChannelId !== undefined || legacy.memberCount !== undefined) {
      await ctx.db.replace(project._id, {
        name: project.name,
        description: project.description,
        color: project.color,
        workspaceId: project.workspaceId,
        creatorId: project.creatorId,
      });
    }
  },
});

export const stripDocumentFields = migrations.define({
  table: "documents",
  migrateOne: async (ctx, doc) => {
    const legacy = doc as Record<string, unknown>;
    if (legacy.roleCount !== undefined) {
      await ctx.db.replace(doc._id, {
        workspaceId: doc.workspaceId,
        name: doc.name,
        tags: doc.tags,
        yjsSnapshotId: doc.yjsSnapshotId,
      });
    }
  },
});

export const stripDiagramFields = migrations.define({
  table: "diagrams",
  migrateOne: async (ctx, doc) => {
    const legacy = doc as Record<string, unknown>;
    if (legacy.roleCount !== undefined) {
      await ctx.db.replace(doc._id, {
        workspaceId: doc.workspaceId,
        name: doc.name,
        tags: doc.tags,
        yjsSnapshotId: doc.yjsSnapshotId,
      });
    }
  },
});

export const stripChannelRoleCount = migrations.define({
  table: "channels",
  migrateOne: async (ctx, channel) => {
    const legacy = channel as Record<string, unknown>;
    if (legacy.roleCount !== undefined) {
      await ctx.db.replace(channel._id, {
        name: channel.name,
        workspaceId: channel.workspaceId,
        type: channel.type,
      });
    }
  },
});

/**
 * Migrate channels from `isPublic: boolean` to `type: "open" | "closed" | "dm"`.
 * isPublic: true → type: "open"
 * isPublic: false → type: "closed"
 *
 * TODO(channel-type-migration): delete this migration and its runner after it
 * has been run in prod (`npx convex run migrations:runChannelTypeMigration --prod`).
 * See also: the optional `isPublic` field in schema.ts, `normalizeChannel` in
 * channels.ts, and the inline fallback in workspaceSidebarData.ts.
 */
export const migrateChannelIsPublicToType = migrations.define({
  table: "channels",
  migrateOne: async (ctx, channel) => {
    const legacy = channel as Record<string, unknown>;
    if (channel.type !== undefined) return; // already migrated
    const isPublic = legacy.isPublic as boolean | undefined;
    const type = isPublic === false ? "closed" : "open";
    await ctx.db.replace(channel._id, {
      name: channel.name,
      workspaceId: channel.workspaceId,
      type,
    });
  },
});

export const runChannelTypeMigration = migrations.runner(
  internal.migrations.migrateChannelIsPublicToType,
);

/**
 * Backfill denormalized `name` and `email` on channelMembers from the users
 * table. After this runs, readers no longer need to fall back to joining
 * users — the fallback in `channelMembers.membersByChannel` and the legacy
 * DM-name resolution in `workspaceSidebarData.ts` can be removed.
 *
 * Idempotent: skips rows that already have both fields populated.
 *
 * TODO(channelmember-denormalization-backfill): delete this migration and its
 * runner after it has been run in prod (`npx convex run migrations:runBackfillChannelMemberDenormalized --prod`).
 * See also: the fallback branches in channelMembers.ts (`membersByChannel`) and
 * workspaceSidebarData.ts (legacy DM name resolution).
 */
export const backfillChannelMemberDenormalized = migrations.define({
  table: "channelMembers",
  migrateOne: async (ctx, member) => {
    if (member.name !== undefined && member.email !== undefined) return;
    const user = await ctx.db.get(member.userId);
    if (!user) return;
    const updates: { name?: string; email?: string } = {};
    if (member.name === undefined) {
      updates.name = user.name ?? user.email ?? "Unknown";
    }
    if (member.email === undefined) {
      updates.email = user.email;
    }
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(member._id, updates);
    }
  },
});

export const runBackfillChannelMemberDenormalized = migrations.runner(
  internal.migrations.backfillChannelMemberDenormalized,
);

/**
 * Rename audit log action prefix from "task." to "tasks." for consistency
 * with the new generic logActivity convention (resourceType.action).
 *
 * Run: npx convex run migrations:migrateAuditActionPrefix
 * Call repeatedly until isDone is true.
 */
export const migrateAuditActionPrefix = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    migrated: v.number(),
    scanned: v.number(),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await auditLog.migrateActionPrefix(ctx, {
      oldPrefix: "task.",
      newPrefix: "tasks.",
      cursor: args.cursor,
      batchSize: 200,
    });
  },
});

/**
 * Backfill `scope` (workspaceId) on existing audit log entries.
 *
 * Scans entries without scope, looks up the resource to resolve its workspaceId,
 * and patches them in batches. Skipped entries (deleted resources) are counted.
 *
 * Run: npx convex run migrations:backfillAuditScope
 * Call repeatedly until isDone is true.
 */
export const backfillAuditScope = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    patched: v.number(),
    skipped: v.number(),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const scan: {
      items: { _id: string; resourceType?: string; resourceId?: string }[];
      cursor: string | null;
      isDone: boolean;
    } = await auditLog.scanWithoutScope(ctx, {
      cursor: args.cursor,
      batchSize: 50,
    });

    // Tables that have a direct workspaceId field
    const tablesWithWorkspaceId = [
      "tasks", "documents", "diagrams", "spreadsheets",
      "channels", "projects", "cycles", "workspaceInvites",
    ] as const;
    type TableWithWsId = (typeof tablesWithWorkspaceId)[number];

    // Resolve workspaceId for each entry
    const patches: { id: string; scope: string }[] = [];
    let skipped = 0;

    for (const item of scan.items) {
      let workspaceId: string | undefined;

      if (!item.resourceType || !item.resourceId) {
        skipped++;
        continue;
      }

      if (item.resourceType === "workspaces") {
        // The resource IS the workspace
        workspaceId = item.resourceId;
      } else {
        // For channelMembers, resourceId is the channelId
        const table = (item.resourceType === "channelMembers" ? "channels" : item.resourceType) as TableWithWsId;
        if (tablesWithWorkspaceId.includes(table)) {
          const id = ctx.db.normalizeId(table, item.resourceId);
          if (id) {
            const doc = await ctx.db.get(id);
            if (doc) {
              workspaceId = doc.workspaceId as string;
            }
          }
        }
      }

      if (workspaceId) {
        patches.push({ id: item._id, scope: workspaceId });
      } else {
        skipped++;
      }
    }

    const patched = patches.length > 0
      ? await auditLog.batchSetScope(ctx, patches)
      : 0;

    return {
      patched,
      skipped,
      cursor: scan.cursor,
      isDone: scan.isDone,
    };
  },
});

/**
 * Backfill workspace aggregate counts from existing data.
 * Run after deploying the aggregate components.
 *
 * npx convex run migrations:runAll
 */
import {
  documentsByWorkspace,
  diagramsByWorkspace,
  spreadsheetsByWorkspace,
  projectsByWorkspace,
  channelsByWorkspace,
  membersByWorkspace,
  tasksByWorkspace,
} from "./dbTriggers.js";

export const backfillDocumentAggregates = migrations.define({
  table: "documents",
  migrateOne: async (ctx, doc) => {
    await documentsByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillDiagramAggregates = migrations.define({
  table: "diagrams",
  migrateOne: async (ctx, doc) => {
    await diagramsByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillSpreadsheetAggregates = migrations.define({
  table: "spreadsheets",
  migrateOne: async (ctx, doc) => {
    await spreadsheetsByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillProjectAggregates = migrations.define({
  table: "projects",
  migrateOne: async (ctx, doc) => {
    await projectsByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillChannelAggregates = migrations.define({
  table: "channels",
  migrateOne: async (ctx, doc) => {
    await channelsByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillMemberAggregates = migrations.define({
  table: "workspaceMembers",
  migrateOne: async (ctx, doc) => {
    await membersByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const backfillTaskAggregates = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, doc) => {
    await tasksByWorkspace.insertIfDoesNotExist(ctx, doc);
  },
});

export const stripTaskStartDate = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    const legacy = task as Record<string, unknown>;
    if (legacy.startDate !== undefined) {
      await ctx.db.patch(task._id, { startDate: undefined } as any);
    }
  },
});

export const stripSpreadsheetFields = migrations.define({
  table: "spreadsheets",
  migrateOne: async (ctx, doc) => {
    const legacy = doc as Record<string, unknown>;
    if (legacy.roleCount !== undefined) {
      await ctx.db.replace(doc._id, {
        workspaceId: doc.workspaceId,
        name: doc.name,
        tags: doc.tags,
        yjsSnapshotId: doc.yjsSnapshotId,
      });
    }
  },
});

// ── Nodes backfill ───────────────────────────────────────────────────

export const backfillDocumentNodes = migrations.define({
  table: "documents",
  migrateOne: async (ctx, doc) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", doc._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: doc.workspaceId,
      resourceType: "document",
      resourceId: doc._id,
      name: doc.name,
      tags: doc.tags ?? [],
    });
  },
});

export const backfillDiagramNodes = migrations.define({
  table: "diagrams",
  migrateOne: async (ctx, doc) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", doc._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: doc.workspaceId,
      resourceType: "diagram",
      resourceId: doc._id,
      name: doc.name,
      tags: doc.tags ?? [],
    });
  },
});

export const backfillSpreadsheetNodes = migrations.define({
  table: "spreadsheets",
  migrateOne: async (ctx, doc) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", doc._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: doc.workspaceId,
      resourceType: "spreadsheet",
      resourceId: doc._id,
      name: doc.name,
      tags: doc.tags ?? [],
    });
  },
});

export const backfillProjectNodes = migrations.define({
  table: "projects",
  migrateOne: async (ctx, doc) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", doc._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: doc.workspaceId,
      resourceType: "project",
      resourceId: doc._id,
      name: doc.name,
      tags: [],
    });
  },
});

export const backfillChannelNodes = migrations.define({
  table: "channels",
  migrateOne: async (ctx, channel) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", channel._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: channel.workspaceId,
      resourceType: "channel",
      resourceId: channel._id,
      name: channel.name,
      tags: [],
    });
  },
});

export const backfillTaskNodes = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", task._id))
      .first();
    if (existing) return;
    await ctx.db.insert("nodes", {
      workspaceId: task.workspaceId,
      resourceType: "task",
      resourceId: task._id,
      name: task.title,
      tags: task.labels ?? [],
      metadata: { type: "task", projectId: task.projectId },
    });
  },
});

// ── Tag system backfill ─────────────────────────────────────────────
// Populate the centralized `tags` dictionary + `entityTags` join from
// each taggable resource's denormalized `tags` (or `labels`) column.
// Idempotent — skips dictionary rows and join rows that already exist.

import type { GenericMutationCtx } from "convex/server";

async function backfillTagsForResourceRow(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    workspaceId: Id<"workspaces">;
    resourceType: "document" | "diagram" | "spreadsheet" | "task";
    resourceId: string;
    rawTags: readonly string[] | undefined,
  },
) {
  if (!args.rawTags || args.rawTags.length === 0) return;
  // Dedupe, trim, lowercase to match the canonical form used by syncTagsForResource.
  const seen = new Set<string>();
  const tagNames: string[] = [];
  for (const candidate of args.rawTags) {
    const normalized = candidate.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 100) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tagNames.push(normalized);
  }

  for (const name of tagNames) {
    // Get-or-create dictionary row.
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_workspace_name", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("name", name),
      )
      .unique();
    const tagId: Id<"tags"> = tag
      ? tag._id
      : await ctx.db.insert("tags", { workspaceId: args.workspaceId, name });

    // Insert join only if it doesn't already exist for this (resource, tag).
    const existingJoins = await ctx.db
      .query("entityTags")
      .withIndex("by_workspace_tag_type", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("tagId", tagId)
          .eq("resourceType", args.resourceType),
      )
      .collect();
    if (existingJoins.some((j) => j.resourceId === args.resourceId)) continue;

    await ctx.db.insert("entityTags", {
      workspaceId: args.workspaceId,
      tagId,
      tagName: name,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    });
  }
}

export const backfillDocumentTags = migrations.define({
  table: "documents",
  migrateOne: async (ctx, doc) => {
    await backfillTagsForResourceRow(ctx, {
      workspaceId: doc.workspaceId,
      resourceType: "document",
      resourceId: doc._id,
      rawTags: doc.tags,
    });
  },
});

export const backfillDiagramTags = migrations.define({
  table: "diagrams",
  migrateOne: async (ctx, doc) => {
    await backfillTagsForResourceRow(ctx, {
      workspaceId: doc.workspaceId,
      resourceType: "diagram",
      resourceId: doc._id,
      rawTags: doc.tags,
    });
  },
});

export const backfillSpreadsheetTags = migrations.define({
  table: "spreadsheets",
  migrateOne: async (ctx, doc) => {
    await backfillTagsForResourceRow(ctx, {
      workspaceId: doc.workspaceId,
      resourceType: "spreadsheet",
      resourceId: doc._id,
      rawTags: doc.tags,
    });
  },
});

export const backfillTaskTags = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    await backfillTagsForResourceRow(ctx, {
      workspaceId: task.workspaceId,
      resourceType: "task",
      resourceId: task._id,
      rawTags: task.labels,
    });
  },
});

// ── Project tag-association cleanup ─────────────────────────────────
// One-shot cleanup after dropping the project↔tag association. Run via
// `runAll` (or directly) to (a) strip any lingering `tags` field from
// project rows and (b) delete entityTags rows that referenced a project.
// Both are idempotent.

export const cleanupProjectTagsField = migrations.define({
  table: "projects",
  migrateOne: async (ctx, project) => {
    const legacy = project as Record<string, unknown>;
    if (legacy.tags === undefined) return;
    await ctx.db.patch(project._id, { tags: undefined } as never);
  },
});

export const cleanupProjectEntityTags = migrations.define({
  table: "entityTags",
  migrateOne: async (ctx, row) => {
    if (row.resourceType !== "project") return;
    await ctx.db.delete(row._id);
  },
});

// ── Edge refactor migrations ─────────────────────────────────────────
// Remove legacy message-source edges (replaced by channel-source edges).
// Strip groupId from all edges (field removed from schema).
// Backfill belongs_to edges for all existing tasks.

export const stripMessageEdges = migrations.define({
  table: "edges",
  migrateOne: async (ctx, edge) => {
    const legacy = edge as Record<string, unknown>;
    if (legacy.sourceType === "message") {
      await ctx.db.delete(edge._id);
    }
  },
});

export const stripEdgeGroupId = migrations.define({
  table: "edges",
  migrateOne: async (ctx, edge) => {
    const legacy = edge as Record<string, unknown>;
    if (legacy.groupId !== undefined) {
      await ctx.db.patch(edge._id, { groupId: undefined } as never);
    }
  },
});

export const backfillChannelMentionEdges = migrations.define({
  table: "messages",
  migrateOne: async (ctx, message) => {
    if (message.deleted) return;
    const targets = extractMessageTargets(message.body);
    if (targets.length === 0) return;
    const channel = await ctx.db.get(message.channelId);
    if (!channel) return;
    for (const target of targets) {
      await ctx.db.insert("edges", {
        sourceType: "channel",
        sourceId: channel._id,
        targetType: target.targetType,
        targetId: target.targetId,
        edgeType: "mentions",
        workspaceId: channel.workspaceId,
        createdAt: message._creationTime,
      } as never);
    }
  },
});

export const backfillTaskBelongsToEdges = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    const existing = await ctx.db
      .query("edges")
      .withIndex("by_source_target", (q) =>
        q.eq("sourceId", task._id).eq("targetId", task.projectId),
      )
      .first();
    if (existing) return;
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: task._id,
      targetType: "project",
      targetId: task.projectId,
      edgeType: "belongs_to",
      workspaceId: task.workspaceId,
      createdAt: task._creationTime,
    });
  },
});

// ── User nodes + edge nodeId backfills ──────────────────────────────

/** Create a user node for each workspace member that doesn't have one. */
export const backfillUserNodes = migrations.define({
  table: "workspaceMembers",
  migrateOne: async (ctx, member) => {
    // Check if a user node already exists for this (user, workspace) pair
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_resource_workspace", (q) =>
        q.eq("resourceId", member.userId).eq("workspaceId", member.workspaceId),
      )
      .first();
    if (existing) return;
    const user = await ctx.db.get(member.userId);
    await ctx.db.insert("nodes", {
      workspaceId: member.workspaceId,
      resourceType: "user",
      resourceId: member.userId,
      name: user?.name ?? user?.email ?? "Unknown",
      tags: [],
    } as never);
  },
});

// ── Notification subscriptions backfill ─────────────────────────────
// Populate notificationSubscriptions for all existing workspace members
// based on their current preferences.

export const backfillNotificationSubscriptions = migrations.define({
  table: "workspaceMembers",
  migrateOne: async (ctx, member) => {
    const { userId, workspaceId } = member;

    // Check if already backfilled (any subscription exists for this user+workspace)
    const existing = await ctx.db
      .query("notificationSubscriptions")
      .withIndex("by_user_workspace", (q) =>
        q.eq("userId", userId).eq("workspaceId", workspaceId),
      )
      .first();
    if (existing) return;

    // Get user's global preferences
    const globalPrefs = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const isEnabled = (cat: NotificationCategory, defaults: Record<string, boolean>) => {
      if (!globalPrefs) return defaults[cat] ?? true;
      return (globalPrefs[cat as keyof typeof globalPrefs] as boolean | undefined) ?? defaults[cat] ?? true;
    };

    // Workspace-scoped broadcast categories
    for (const cat of BROADCAST_WORKSPACE_CATEGORIES) {
      if (isEnabled(cat, DEFAULT_PREFERENCES)) {
        await ctx.db.insert("notificationSubscriptions", {
          workspaceId, userId, category: cat, scope: workspaceId,
        });
      }
    }

    // Channel-scoped broadcast categories
    const publicChannels = await ctx.db
      .query("channels")
      .withIndex("by_type_workspace", (q) =>
        q.eq("type", "open").eq("workspaceId", workspaceId),
      )
      .collect();

    const channelMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .collect();

    const allChannelIds = new Set([
      ...publicChannels.map((c) => c._id as string),
      ...channelMemberships.map((m) => m.channelId as string),
    ]);

    for (const channelId of allChannelIds) {
      const channelPrefs = await ctx.db
        .query("channelNotificationPreferences")
        .withIndex("by_user_channel", (q) =>
          q.eq("userId", userId).eq("channelId", channelId as Id<"channels">),
        )
        .unique();

      for (const cat of BROADCAST_CHANNEL_CATEGORIES) {
        const enabled = channelPrefs
          ? channelPrefs[cat]
          : isEnabled(cat, DEFAULT_CHANNEL_CHAT_PREFERENCES);
        if (enabled) {
          await ctx.db.insert("notificationSubscriptions", {
            workspaceId, userId, category: cat, scope: channelId,
          });
        }
      }
    }
  },
});

/**
 * Move task→tag joins from the polymorphic `entityTags` table to the new
 * `taskTags` table. Walks every entityTags row; only acts on those with
 * resourceType === "task". Looks up the task to capture projectId and
 * completed (denormalized on taskTags), inserts the new row, then deletes
 * the legacy one. Orphaned task entityTags (task already deleted) are
 * dropped without re-creating.
 *
 * Idempotent — once an entityTags row is moved it's gone, so re-running is
 * safe and a no-op.
 *
 * Direct `ctx.db` writes intentionally bypass `writerWithTriggers` —
 * migrations sit outside the runtime invariants (uniqueness etc. is already
 * guaranteed by the source data).
 */
export const migrateTaskEntityTagsToTaskTags = migrations.define({
  table: "entityTags",
  migrateOne: async (ctx, row) => {
    if (row.resourceType !== "task") return;

    const taskId = row.resourceId as Id<"tasks">;
    const task = await ctx.db.get(taskId);
    if (task) {
      await ctx.db.insert("taskTags", {
        workspaceId: row.workspaceId,
        projectId: task.projectId,
        taskId,
        tagId: row.tagId,
        tagName: row.tagName,
        completed: task.completed,
      });
    }

    await ctx.db.delete(row._id);
  },
});

/**
 * Backfill `dueDate` and `plannedStartDate` on existing taskTags rows that
 * predate the denormalization. The trigger keeps these columns fresh for new
 * writes; this migration covers rows from before the trigger existed.
 *
 * Idempotent — only patches rows whose denormalized columns differ from the
 * source task. Rows already in sync are skipped.
 */
export const backfillTaskTagsSortFields = migrations.define({
  table: "taskTags",
  migrateOne: async (ctx, row) => {
    const task = await ctx.db.get(row.taskId);
    if (!task) {
      // Orphaned join — cleanup is the cascade's job, not this migration's.
      return;
    }
    const patch: { dueDate?: string; plannedStartDate?: string } = {};
    if (row.dueDate !== task.dueDate) patch.dueDate = task.dueDate;
    if (row.plannedStartDate !== task.plannedStartDate) {
      patch.plannedStartDate = task.plannedStartDate;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(row._id, patch);
    }
  },
});

/**
 * Backfill `assigneeId` on existing taskTags rows that predate the
 * denormalization. The trigger keeps the column fresh for new writes; this
 * migration covers rows from before the trigger existed.
 *
 * Idempotent — only patches rows whose denormalized assigneeId differs from
 * the source task. Rows already in sync are skipped.
 */
export const backfillTaskTagsAssigneeId = migrations.define({
  table: "taskTags",
  migrateOne: async (ctx, row) => {
    const task = await ctx.db.get(row.taskId);
    if (!task) {
      // Orphaned join — cleanup is the cascade's job, not this migration's.
      return;
    }
    if (row.assigneeId !== task.assigneeId) {
      await ctx.db.patch(row._id, { assigneeId: task.assigneeId });
    }
  },
});

/** Populate sourceNodeId and targetNodeId on existing edges. */
export const backfillEdgeNodeIds = migrations.define({
  table: "edges",
  migrateOne: async (ctx, edge) => {
    // Skip if already backfilled
    const e = edge as Record<string, unknown>;
    if (e.sourceNodeId && e.targetNodeId) return;

    const sourceNode = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", edge.sourceId))
      .first();

    // For user targets, find the node in the correct workspace
    let targetNode;
    if (edge.targetType === "user") {
      const nodes = await ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", edge.targetId))
        .collect();
      targetNode = nodes.find((n) => n.workspaceId === edge.workspaceId);
    } else {
      targetNode = await ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", edge.targetId))
        .first();
    }

    const patch: Record<string, unknown> = {};
    if (sourceNode && !e.sourceNodeId) patch.sourceNodeId = sourceNode._id;
    if (targetNode && !e.targetNodeId) patch.targetNodeId = targetNode._id;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(edge._id, patch as never);
    }
  },
});
