import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { DEFAULT_DIAGRAM_NAME } from "@shared/constants";
import { getEnrichedBacklinks } from "./edges";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import { deletionResultValidator } from "./validators";
import { requireWorkspaceMember, requireResourceMember, checkResourceMember } from "./authHelpers";
import { syncTagsForResource } from "./tagSync";
import { searchResourcesByTag, searchResourcesByFavorite } from "./resourceSearch";
import { notify } from "./utils/notify";

const diagramValidator = v.object({
  _id: v.id("diagrams"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
  yjsSnapshotId: v.optional(v.id("_storage")),
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(diagramValidator),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    return ctx.db
      .query("diagrams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isFavorite: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(diagramValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite, paginationOpts }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    if (searchText?.trim()) {
      return await ctx.db
        .query("diagrams")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .paginate(paginationOpts);
    }

    if (tags && tags.length > 0) {
      return await searchResourcesByTag(ctx, {
        workspaceId,
        resourceType: "diagram",
        tags,
        paginationOpts,
      });
    }

    if (isFavorite === true) {
      return await searchResourcesByFavorite(ctx, {
        workspaceId,
        userId,
        resourceType: "diagram",
        paginationOpts,
      });
    }

    return await ctx.db
      .query("diagrams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const updateTags = mutation({
  args: {
    id: v.id("diagrams"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    const { resource } = await requireResourceMember(ctx, "diagrams", id);
    const normalized = await syncTagsForResource(ctx, {
      workspaceId: resource.workspaceId,
      resourceType: "diagram",
      resourceId: id,
      nextTagNames: tags,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { tags: normalized });
    return null;
  },
});

export const get = query({
  args: { id: v.id("diagrams") },
  returns: v.union(diagramValidator, v.null()),
  handler: async (ctx, { id }) => {
    const result = await checkResourceMember(ctx, "diagrams", id);
    if (!result) return null;
    return result.resource;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
  },
  returns: v.id("diagrams"),
  handler: async (ctx, { workspaceId, name }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Generate a default name with timestamp if none provided
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    const diagramName = name || `${DEFAULT_DIAGRAM_NAME} ${date} ${time}`;

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const diagramId = await db.insert("diagrams", {
      workspaceId,
      name: diagramName,
    });

    await logActivity(ctx, {
      userId, resourceType: "diagrams", resourceId: diagramId,
      action: "created", newValue: diagramName, resourceName: diagramName, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "diagramCreated",
      userId,
      userName: getUserDisplayName(user),
      scope: workspaceId,
      title: `${getUserDisplayName(user)} created a diagram`,
      body: diagramName,
      url: `/workspaces/${workspaceId}/diagrams/${diagramId}`,
    });

    return diagramId;
  },
});

export const rename = mutation({
  args: { id: v.id("diagrams"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const { userId, resource: diagram } = await requireResourceMember(ctx, "diagrams", id);

    await logActivity(ctx, {
      userId, resourceType: "diagrams", resourceId: id,
      action: "renamed", oldValue: diagram.name, newValue: name, resourceName: name, scope: diagram.workspaceId,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { name });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("diagrams"), force: v.optional(v.boolean()) },
  returns: deletionResultValidator,
  handler: async (ctx, { id, force }) => {
    const { userId, resource: diagram } = await requireResourceMember(ctx, "diagrams", id);

    // Check for references unless force-deleting
    if (!force) {
      const references = await getEnrichedBacklinks(ctx, id, diagram.workspaceId);
      if (references.length > 0) {
        return { status: "has_references" as const, references };
      }
    }

    await logActivity(ctx, {
      userId, resourceType: "diagrams", resourceId: id,
      action: "deleted", oldValue: diagram.name, resourceName: diagram.name, scope: diagram.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "diagramDeleted",
      userId,
      userName: getUserDisplayName(user),
      scope: diagram.workspaceId,
      title: `${getUserDisplayName(user)} deleted a diagram`,
      body: diagram.name,
      url: `/workspaces/${diagram.workspaceId}`,
    });

    await cascadeDelete.deleteWithCascade(ctx, "diagrams", id, {
      onComplete: logCascadeSummary({
        userId, resourceType: "diagrams", resourceId: id, scope: diagram.workspaceId,
      }),
    });
    return { status: "deleted" as const };
  },
});
