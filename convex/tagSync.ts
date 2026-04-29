import { ConvexError, v } from "convex/values";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWorkspaceMember } from "./authHelpers";
import { triggers } from "./dbTriggers";
import { WorkspaceRole } from "@shared/enums/roles";

const TAG_NAME_MAX_LENGTH = 100;

// `entityTags.resourceType` keeps the "task" literal in its union for the
// duration of the taskTags migration window. After the migration soaks in
// prod we can drop "task" from `entityTags`'s schema in a follow-up PR.
export const resourceTypeSchema = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
  v.literal("task"),
);

export type TaggableResourceType =
  | "document"
  | "diagram"
  | "spreadsheet"
  | "project"
  | "task";

/** Resources that flow through `syncTagsForResource` (excludes tasks, which
 *  are project-scoped and use `syncTaskTags` against the `taskTags` table). */
export type ListableResourceType =
  | "document"
  | "diagram"
  | "spreadsheet"
  | "project";

/** Trim, lowercase, drop empties / over-length, dedupe. */
export function normalizeTagList(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of raw) {
    const normalized = candidate.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (normalized.length > TAG_NAME_MAX_LENGTH) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * Reconcile the central `tags` + `entityTags` tables with `nextTagNames` for
 * one workspace-scoped resource. The caller still owns patching the
 * resource's denormalized `tags` column — this lets the caller batch the
 * patch with other field updates and fire `writerWithTriggers` once.
 *
 * Tasks use `syncTaskTags` instead — they're project-scoped and live in the
 * `taskTags` table, which has tighter indexes for project-bounded queries.
 *
 * Returns the canonical (normalized + deduped) tag list.
 */
export async function syncTagsForResource(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    resourceType: ListableResourceType;
    resourceId: string;
    nextTagNames: readonly string[];
  },
): Promise<string[]> {
  const db = writerWithTriggers(ctx, ctx.db, triggers);
  const normalized = normalizeTagList(args.nextTagNames);

  // Read existing entityTags rows for this resource. The single-field
  // `by_resource_id` index returns rows across all resourceTypes, so we
  // filter on resourceType after.
  const existingAll = await ctx.db
    .query("entityTags")
    .withIndex("by_resource_id", (q) => q.eq("resourceId", args.resourceId))
    .collect();
  const existing = existingAll.filter((et) => et.resourceType === args.resourceType);

  const desired = new Set(normalized);
  const existingNames = new Set(existing.map((et) => et.tagName));

  for (const et of existing) {
    if (desired.has(et.tagName)) continue;
    await db.delete(et._id);
  }

  for (const name of normalized) {
    if (existingNames.has(name)) continue;
    const tagId = await ensureTagDictionaryRow(ctx, args.workspaceId, name);
    await db.insert("entityTags", {
      workspaceId: args.workspaceId,
      tagId,
      tagName: name,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    });
  }

  return normalized;
}

/**
 * Reconcile the central `tags` + `taskTags` tables with `nextTagNames` for a
 * single task. Returns the canonical (normalized + deduped) tag list, which
 * the caller patches into `tasks.labels`.
 *
 * `completed` is denormalized onto `taskTags` to keep the primary access
 * pattern ("completed tasks in project P tagged X") on a single indexed
 * range scan. Subsequent flips of the task's completion status are
 * propagated by a tasks-table trigger in dbTriggers.ts — callers don't need
 * to re-call this function on status changes.
 */
export async function syncTaskTags(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId: Id<"projects">;
    taskId: Id<"tasks">;
    completed: boolean;
    dueDate?: string;
    plannedStartDate?: string;
    assigneeId?: Id<"users">;
    nextTagNames: readonly string[];
  },
): Promise<string[]> {
  const db = writerWithTriggers(ctx, ctx.db, triggers);
  const normalized = normalizeTagList(args.nextTagNames);

  const existing = await ctx.db
    .query("taskTags")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .collect();

  const desired = new Set(normalized);
  const existingNames = new Set(existing.map((tt) => tt.tagName));

  for (const tt of existing) {
    if (desired.has(tt.tagName)) continue;
    await db.delete(tt._id);
  }

  for (const name of normalized) {
    if (existingNames.has(name)) continue;
    const tagId = await ensureTagDictionaryRow(ctx, args.workspaceId, name);
    await db.insert("taskTags", {
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      taskId: args.taskId,
      tagId,
      tagName: name,
      completed: args.completed,
      dueDate: args.dueDate,
      plannedStartDate: args.plannedStartDate,
      assigneeId: args.assigneeId,
    });
  }

  return normalized;
}

/** Get-or-create a `tags` dictionary row. Returns the tagId. */
async function ensureTagDictionaryRow(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  name: string,
): Promise<Id<"tags">> {
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_workspace_name", (q) =>
      q.eq("workspaceId", workspaceId).eq("name", name),
    )
    .unique();
  if (existing) return existing._id;
  const db = writerWithTriggers(ctx, ctx.db, triggers);
  return db.insert("tags", { workspaceId, name });
}

// ── Public mutations ──────────────────────────────────────────────────

export const createTag = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
  },
  returns: v.id("tags"),
  handler: async (ctx, { workspaceId, name }) => {
    await requireWorkspaceMember(ctx, workspaceId);
    const normalized = name.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new ConvexError("Tag name cannot be empty");
    }
    if (normalized.length > TAG_NAME_MAX_LENGTH) {
      throw new ConvexError(`Tag name cannot exceed ${TAG_NAME_MAX_LENGTH} characters`);
    }
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_workspace_name", (q) =>
        q.eq("workspaceId", workspaceId).eq("name", normalized),
      )
      .unique();
    if (existing) return existing._id;
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    return db.insert("tags", { workspaceId, name: normalized });
  },
});

/**
 * Delete a tag from the workspace dictionary AND every resource that uses it.
 * Workspace-admin only. Walks both `entityTags` and `taskTags`, patches each
 * affected resource's denormalized array, then deletes the join + dictionary
 * rows.
 */
export const deleteTag = mutation({
  args: { tagId: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, { tagId }) => {
    const tag = await ctx.db.get(tagId);
    if (!tag) throw new ConvexError("Tag not found");
    await requireWorkspaceMember(ctx, tag.workspaceId, { role: WorkspaceRole.ADMIN });

    const db = writerWithTriggers(ctx, ctx.db, triggers);

    // Strip from non-task resources via entityTags.
    const entityJoins = await ctx.db
      .query("entityTags")
      .withIndex("by_workspace_tag", (q) =>
        q.eq("workspaceId", tag.workspaceId).eq("tagId", tagId),
      )
      .collect();
    for (const join of entityJoins) {
      await stripTagFromResource(ctx, join.resourceType, join.resourceId, tag.name);
      await db.delete(join._id);
    }

    // Strip from tasks via taskTags.
    const taskJoins = await ctx.db
      .query("taskTags")
      .withIndex("by_workspace_tag", (q) =>
        q.eq("workspaceId", tag.workspaceId).eq("tagId", tagId),
      )
      .collect();
    for (const join of taskJoins) {
      await stripTagFromTask(ctx, join.taskId, tag.name);
      await db.delete(join._id);
    }

    await db.delete(tagId);
    return null;
  },
});

async function stripTagFromResource(
  ctx: MutationCtx,
  resourceType: TaggableResourceType,
  resourceId: string,
  tagName: string,
): Promise<void> {
  switch (resourceType) {
    case "document": {
      const id = resourceId as Id<"documents">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.tags ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { tags: next });
      return;
    }
    case "diagram": {
      const id = resourceId as Id<"diagrams">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.tags ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { tags: next });
      return;
    }
    case "spreadsheet": {
      const id = resourceId as Id<"spreadsheets">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.tags ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { tags: next });
      return;
    }
    case "project": {
      const id = resourceId as Id<"projects">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.tags ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { tags: next });
      return;
    }
    case "task": {
      // Legacy entityTags rows for tasks still exist before migration runs.
      // After the migration, this branch becomes dead code and the union
      // literal can be dropped.
      await stripTagFromTask(ctx, resourceId as Id<"tasks">, tagName);
      return;
    }
  }
}

async function stripTagFromTask(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  tagName: string,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;
  const next = (task.labels ?? []).filter((t) => t !== tagName);
  await ctx.db.patch(taskId, { labels: next });
}
