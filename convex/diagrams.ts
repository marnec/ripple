import { v } from "convex/values";
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
  },
  returns: v.array(diagramValidator),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("diagrams")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("diagrams")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .order("desc")
        .collect();
    }

    if (tags && tags.length > 0) {
      results = results.filter(
        (doc) => doc.tags && tags.every((t) => doc.tags!.includes(t)),
      );
    }

    if (isFavorite !== undefined) {
      const favs = await ctx.db
        .query("favorites")
        .withIndex("by_workspace_user_type", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", "diagram"),
        )
        .collect();
      const favSet = new Set(favs.map((f) => f.resourceId));
      results = isFavorite
        ? results.filter((doc) => favSet.has(doc._id))
        : results.filter((doc) => !favSet.has(doc._id));
    }

    return results;
  },
});

export const updateTags = mutation({
  args: {
    id: v.id("diagrams"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    await requireResourceMember(ctx, "diagrams", id);

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { tags });
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
      workspaceId,
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
      workspaceId: diagram.workspaceId,
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
