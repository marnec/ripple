import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
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
import { syncTagsForResource } from "./tagSync";
import { searchResourcesByTag, searchResourcesByFavorite } from "./resourceSearch";
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
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(spreadsheetValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite, paginationOpts }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    if (searchText?.trim()) {
      return await ctx.db
        .query("spreadsheets")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .paginate(paginationOpts);
    }

    if (tags && tags.length > 0) {
      return await searchResourcesByTag(ctx, {
        workspaceId,
        resourceType: "spreadsheet",
        tags,
        paginationOpts,
      });
    }

    if (isFavorite === true) {
      return await searchResourcesByFavorite(ctx, {
        workspaceId,
        userId,
        resourceType: "spreadsheet",
        paginationOpts,
      });
    }

    return await ctx.db
      .query("spreadsheets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const updateTags = mutation({
  args: {
    id: v.id("spreadsheets"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    const { resource } = await requireResourceMember(ctx, "spreadsheets", id);
    const normalized = await syncTagsForResource(ctx, {
      workspaceId: resource.workspaceId,
      resourceType: "spreadsheet",
      resourceId: id,
      nextTagNames: tags,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { tags: normalized });
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
