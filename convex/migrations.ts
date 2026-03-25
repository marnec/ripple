import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel, Id } from "./_generated/dataModel.js";
import { internalMutation } from "./_generated/server.js";
import { v } from "convex/values";
import { auditLog } from "./auditLog.js";
import { extractMessageTargets } from "./utils/blocknote.js";

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
        isPublic: channel.isPublic,
      });
    }
  },
});

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
} from "./workspaceAggregates.js";

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
      tags: doc.tags ?? [],
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
    });
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
        sourceType: "channel" as "document", // cast: generated types lag behind schema
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
      edgeType: "belongs_to" as "embeds",
      workspaceId: task.workspaceId,
      createdAt: task._creationTime,
    });
  },
});
