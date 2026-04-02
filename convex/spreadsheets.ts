import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_SPREADSHEET_NAME } from "@shared/constants";
import { getEnrichedBacklinks } from "./edges";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import { deletionResultValidator } from "./validators";
import { requireWorkspaceMember, requireResourceMember, checkResourceMember } from "./authHelpers";
import { notify } from "./utils/notify";

const spreadsheetValidator = v.object({
  _id: v.id("spreadsheets"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
  yjsSnapshotId: v.optional(v.id("_storage")),
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(spreadsheetValidator),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    return ctx.db
      .query("spreadsheets")
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
  returns: v.array(spreadsheetValidator),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("spreadsheets")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("spreadsheets")
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
          q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", "spreadsheet"),
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
    id: v.id("spreadsheets"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    await requireResourceMember(ctx, "spreadsheets", id);

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { tags });
    return null;
  },
});

export const get = query({
  args: { id: v.id("spreadsheets") },
  returns: v.union(spreadsheetValidator, v.null()),
  handler: async (ctx, { id }) => {
    const result = await checkResourceMember(ctx, "spreadsheets", id);
    if (!result) return null;
    return result.resource;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
  },
  returns: v.id("spreadsheets"),
  handler: async (ctx, { workspaceId, name }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Generate a default name with timestamp if none provided
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    const spreadsheetName = name || `${DEFAULT_SPREADSHEET_NAME} ${date} ${time}`;

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const spreadsheetId = await db.insert("spreadsheets", {
      workspaceId,
      name: spreadsheetName,
    });

    await logActivity(ctx, {
      userId, resourceType: "spreadsheets", resourceId: spreadsheetId,
      action: "created", newValue: spreadsheetName, resourceName: spreadsheetName, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "spreadsheetCreated",
      userId,
      userName: getUserDisplayName(user),
      scope: workspaceId,
      title: `${getUserDisplayName(user)} created a spreadsheet`,
      body: spreadsheetName,
      url: `/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`,
    });

    return spreadsheetId;
  },
});

export const rename = mutation({
  args: { id: v.id("spreadsheets"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const { userId, resource: spreadsheet } = await requireResourceMember(ctx, "spreadsheets", id);

    await logActivity(ctx, {
      userId, resourceType: "spreadsheets", resourceId: id,
      action: "renamed", oldValue: spreadsheet.name, newValue: name, resourceName: name, scope: spreadsheet.workspaceId,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { name });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("spreadsheets"), force: v.optional(v.boolean()) },
  returns: deletionResultValidator,
  handler: async (ctx, { id, force }) => {
    const { userId, resource: spreadsheet } = await requireResourceMember(ctx, "spreadsheets", id);

    // Check for references unless force-deleting
    if (!force) {
      const references = await getEnrichedBacklinks(ctx, id, spreadsheet.workspaceId);
      if (references.length > 0) {
        return { status: "has_references" as const, references };
      }
    }

    await logActivity(ctx, {
      userId, resourceType: "spreadsheets", resourceId: id,
      action: "deleted", oldValue: spreadsheet.name, resourceName: spreadsheet.name, scope: spreadsheet.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "spreadsheetDeleted",
      userId,
      userName: getUserDisplayName(user),
      scope: spreadsheet.workspaceId,
      title: `${getUserDisplayName(user)} deleted a spreadsheet`,
      body: spreadsheet.name,
      url: `/workspaces/${spreadsheet.workspaceId}`,
    });

    await cascadeDelete.deleteWithCascade(ctx, "spreadsheets", id, {
      onComplete: logCascadeSummary({
        userId, resourceType: "spreadsheets", resourceId: id, scope: spreadsheet.workspaceId,
      }),
    });
    return { status: "deleted" as const };
  },
});
