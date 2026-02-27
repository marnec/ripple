import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_SPREADSHEET_NAME } from "@shared/constants";
import { getEnrichedReferencesTo } from "./contentReferences";

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
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${workspaceId}"`,
      );

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
  returns: v.any(),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

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

    if (isFavorite) {
      const favs = await ctx.db
        .query("favorites")
        .withIndex("by_workspace_user_type", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", "spreadsheet"),
        )
        .collect();
      const favSet = new Set(favs.map((f) => f.resourceId));
      results = results.filter((doc) => favSet.has(doc._id));
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(id);
    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", spreadsheet.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    await ctx.db.patch(id, { tags });
    return null;
  },
});

export const get = query({
  args: { id: v.id("spreadsheets") },
  returns: v.union(spreadsheetValidator, v.null()),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) return null;

    const spreadsheet = await ctx.db.get(id);

    if (!spreadsheet) return null;

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", spreadsheet.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership) return null;

    return spreadsheet;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
  },
  returns: v.id("spreadsheets"),
  handler: async (ctx, { workspaceId, name }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${workspaceId}"`,
      );

    // Generate a default name with timestamp if none provided
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    const spreadsheetName = name || `${DEFAULT_SPREADSHEET_NAME} ${date} ${time}`;

    const spreadsheetId = await ctx.db.insert("spreadsheets", {
      workspaceId,
      name: spreadsheetName,
    });

    return spreadsheetId;
  },
});

export const rename = mutation({
  args: { id: v.id("spreadsheets"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(id);

    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", spreadsheet.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${spreadsheet.workspaceId}"`,
      );

    await ctx.db.patch(id, { name });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("spreadsheets"), force: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, { id, force }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(id);

    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", spreadsheet.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${spreadsheet.workspaceId}"`,
      );

    // Check for references unless force-deleting
    if (!force) {
      const references = await getEnrichedReferencesTo(ctx, id);
      if (references.length > 0) {
        return { status: "has_references" as const, references };
      }
    }

    // Clean up cached cell references
    const cellRefs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", id))
      .collect();
    await Promise.all(cellRefs.map((ref) => ctx.db.delete(ref._id)));

    // Clean up incoming content references pointing to this spreadsheet
    const incomingRefs = await ctx.db
      .query("contentReferences")
      .withIndex("by_target", (q) => q.eq("targetId", id))
      .collect();
    await Promise.all(incomingRefs.map((r) => ctx.db.delete(r._id)));

    await ctx.db.delete(id);
    return { status: "deleted" as const };
  },
});
