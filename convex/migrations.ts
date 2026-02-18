import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import { DataModel, Id } from "./_generated/dataModel.js";

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
