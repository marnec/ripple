import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./functions";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { scheduleTaskReassign } from "./taskReassignPool";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWorkspaceMember } from "./authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

const TAG_NAME_MAX_LENGTH = 100;

// `entityTags.resourceType` keeps the "task" and "project" literals in its
// union for the duration of the taskTags migration / project-tag-removal
// window. After the cleanup migrations soak in prod we can drop them from
// `entityTags`'s schema in a follow-up PR.
export const resourceTypeSchema = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
  v.literal("task"),
  v.literal("calendarEvent"),
  v.literal("eventSeries"),
);

export type TaggableResourceType =
  | "document"
  | "diagram"
  | "spreadsheet"
  | "project"
  | "task"
  | "calendarEvent"
  | "eventSeries";

/** Resources that flow through `syncTagsForResource` (excludes tasks, which
 *  are project-scoped and use `syncTaskTags` against the `taskTags` table,
 *  and projects, whose tag association was removed). */
export type ListableResourceType =
  | "document"
  | "diagram"
  | "spreadsheet"
  | "calendarEvent"
  | "eventSeries";

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
 * patch with other field updates into a single write.
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
    await ctx.db.delete(et._id);
  }

  for (const name of normalized) {
    if (existingNames.has(name)) continue;
    const tagId = await ensureTagDictionaryRow(ctx, args.workspaceId, name);
    await ctx.db.insert("entityTags", {
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
  const normalized = normalizeTagList(args.nextTagNames);

  const existing = await ctx.db
    .query("taskTags")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .collect();

  const desired = new Set(normalized);
  const existingNames = new Set(existing.map((tt) => tt.tagName));

  for (const tt of existing) {
    if (desired.has(tt.tagName)) continue;
    await ctx.db.delete(tt._id);
  }

  for (const name of normalized) {
    if (existingNames.has(name)) continue;
    const tagId = await ensureTagDictionaryRow(ctx, args.workspaceId, name);
    await ctx.db.insert("taskTags", {
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
  if (existing) {
    // A retired row is not a row to hand back. Its drain is still walking the
    // join tables and will delete it at the end, so a join created against it
    // now would outlive it. Inserting a second row with this name is not an
    // option either — the uniqueness trigger owns (workspaceId, name) — so the
    // application fails loudly rather than dangling.
    if (existing.pendingDeletion) {
      throw new ConvexError(`Tag "${name}" is being deleted`);
    }
    return existing._id;
  }
  return ctx.db.insert("tags", { workspaceId, name });
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
    return ctx.db.insert("tags", { workspaceId, name: normalized });
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
    if (tag.pendingDeletion) {
      throw new ConvexError("Tag deletion already in progress");
    }

    // Stripping the tag is one read, one patch and one join delete per tagged
    // resource — plus, on tasks, the nodes trigger's labelsChanged branch. That
    // is unbounded work in a user-facing mutation, and since Convex is atomic,
    // crossing the cap would make a widely-applied tag permanently undeletable.
    // So: retire the dictionary row now (it stops appearing in pickers and
    // cannot be re-created underneath the drain), and strip the resources in
    // batches. Same shape as `taskStatuses.remove`.
    await ctx.db.patch(tagId, { pendingDeletion: true });

    await scheduleTaskReassign(
      ctx,
      internal.tagSync.stripTagEverywhere,
      { kind: "tagSync:stripTagEverywhere", key: tagId },
      { tagId },
    );

    return null;
  },
});

const STRIP_BATCH_SIZE = 100;

/**
 * One batch of the tag-delete drain: `entityTags` first, then `taskTags`.
 *
 * Self-advancing for the same reason `fetchTasksForStatusBatch` is — each batch
 * deletes the join rows it just processed, so the next `.take()` returns the
 * next chunk and the loop ends when both tables are empty for this tag.
 */
export const stripTagBatch = internalMutation({
  args: { tagId: v.id("tags"), limit: v.number() },
  returns: v.number(),
  handler: async (ctx, { tagId, limit }) => {
    const tag = await ctx.db.get(tagId);
    if (!tag) return 0;

    const entityJoins = await ctx.db
      .query("entityTags")
      .withIndex("by_workspace_tag", (q) =>
        q.eq("workspaceId", tag.workspaceId).eq("tagId", tagId),
      )
      .take(limit);
    for (const join of entityJoins) {
      await stripTagFromResource(ctx, join.resourceType, join.resourceId, tag.name);
      await ctx.db.delete(join._id);
    }
    if (entityJoins.length > 0) return entityJoins.length;

    const taskJoins = await ctx.db
      .query("taskTags")
      .withIndex("by_workspace_tag", (q) =>
        q.eq("workspaceId", tag.workspaceId).eq("tagId", tagId),
      )
      .take(limit);
    for (const join of taskJoins) {
      await stripTagFromTask(ctx, join.taskId, tag.name);
      await ctx.db.delete(join._id);
    }
    return taskJoins.length;
  },
});

/** Drops the dictionary row once no join references it. */
export const finalizeTagDelete = internalMutation({
  args: { tagId: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, { tagId }) => {
    const tag = await ctx.db.get(tagId);
    if (!tag) return null;
    await ctx.db.delete(tagId);
    return null;
  },
});

/**
 * **Restart safety.** `taskReassignPool` retries this, and a retry re-enters at
 * the first batch. Safe because each batch deletes the join rows it processed:
 * a replay re-queries `entityTags` / `taskTags` for the tag and finds only what
 * is genuinely left. Stripping a name from a `tags` array is itself idempotent,
 * and `finalizeTagDelete` no-ops on a tag already gone.
 */
export const stripTagEverywhere = internalAction({
  args: { tagId: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, { tagId }) => {
    while (true) {
      const stripped: number = await ctx.runMutation(
        internal.tagSync.stripTagBatch,
        { tagId, limit: STRIP_BATCH_SIZE },
      );
      if (stripped === 0) break;
    }
    await ctx.runMutation(internal.tagSync.finalizeTagDelete, { tagId });
    return null;
  },
});

/**
 * Remove one tag name from a resource's denormalized `tags` array.
 *
 * The patch is deliberately NOT guarded on "did the array actually change".
 * Skipping the write when `next` has the same length looks like a free
 * no-op-write saving, but it is the one case that must stay loud: a join row
 * whose `resourceType` does not match the table its `resourceId` lives in
 * resolves to a foreign row, reads no `tags`, and fails schema validation on
 * the patch — which is how a corrupt join surfaces as a
 * `tagSync:stripTagEverywhere` background job failure instead of being silently
 * deleted by the drain. See `tests/backgroundDrainRetry.test.ts`, which plants
 * exactly that row. The redundant-write case is drift-only and cold; the
 * corruption case is the one worth paying for.
 */
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
    case "eventSeries": {
      const id = resourceId as Id<"eventSeries">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.tags ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { tags: next });
      return;
    }
    case "project": {
      // Projects no longer carry a tags field — entityTags rows for projects
      // are residual from before the association was removed and are deleted
      // by `cleanupProjectEntityTags` in migrations.ts. Until that migration
      // runs in prod, deleteTag may still encounter them; nothing to patch.
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

/** As `stripTagFromResource`, over a task's `labels` — unguarded for the same reason. */
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
