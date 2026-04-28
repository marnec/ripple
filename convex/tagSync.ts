import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWorkspaceMember } from "./authHelpers";
import { WorkspaceRole } from "@shared/enums/roles";

const TAG_NAME_MAX_LENGTH = 100;

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
 * one resource. The caller still owns patching the resource's denormalized
 * column (`tags` for four tables, `labels` for tasks) — this lets the caller
 * batch the patch with other field updates and fire `writerWithTriggers` once.
 *
 * Returns the canonical (normalized + deduped) tag list, which the caller
 * should use as the value for the denormalized column.
 */
export async function syncTagsForResource(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    resourceType: TaggableResourceType;
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

  // Remove tags no longer present.
  for (const et of existing) {
    if (desired.has(et.tagName)) continue;
    await ctx.db.delete(et._id);
  }

  // Add new tags. Ensure the dictionary row exists, then insert the join.
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
  return ctx.db.insert("tags", { workspaceId, name });
}

// ── Public mutations ──────────────────────────────────────────────────

/**
 * Explicitly create a tag in the workspace dictionary without attaching it
 * to any resource. Allows curating a vocabulary independent of usage.
 * Idempotent: returns the existing tagId if present.
 */
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
 * Workspace-admin only. Walks `entityTags` and patches each affected
 * resource's denormalized column to remove the tag string.
 */
export const deleteTag = mutation({
  args: { tagId: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, { tagId }) => {
    const tag = await ctx.db.get(tagId);
    if (!tag) throw new ConvexError("Tag not found");
    await requireWorkspaceMember(ctx, tag.workspaceId, { role: WorkspaceRole.ADMIN });

    // Remove from every resource's denormalized column, then delete joins.
    const joins = await ctx.db
      .query("entityTags")
      .withIndex("by_workspace_tag", (q) =>
        q.eq("workspaceId", tag.workspaceId).eq("tagId", tagId),
      )
      .collect();

    for (const join of joins) {
      await stripTagFromResource(ctx, join.resourceType, join.resourceId, tag.name);
      await ctx.db.delete(join._id);
    }

    await ctx.db.delete(tagId);
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
      const id = resourceId as Id<"tasks">;
      const doc = await ctx.db.get(id);
      if (!doc) return;
      const next = (doc.labels ?? []).filter((t) => t !== tagName);
      await ctx.db.patch(id, { labels: next });
      return;
    }
  }
}
