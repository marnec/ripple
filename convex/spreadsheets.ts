import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { SpreadsheetRole } from "@shared/enums";
import { DEFAULT_SPREADSHEET_NAME } from "@shared/constants";

const spreadsheetValidator = v.object({
  _id: v.id("spreadsheets"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
  yjsSnapshotId: v.optional(v.id("_storage")),
  roleCount: v.optional(v.object({
    admin: v.number(),
    member: v.number(),
  })),
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
      roleCount: {
        [SpreadsheetRole.ADMIN]: 1,
        [SpreadsheetRole.MEMBER]: 0,
      },
    });

    await ctx.db.insert("spreadsheetMembers", {
      spreadsheetId,
      userId,
      role: SpreadsheetRole.ADMIN,
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
  args: { id: v.id("spreadsheets") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
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

    // Clean up spreadsheet members
    const spreadsheetMembers = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", id))
      .collect();
    await Promise.all(spreadsheetMembers.map((member) => ctx.db.delete(member._id)));

    // Clean up cached cell references
    const cellRefs = await ctx.db
      .query("spreadsheetCellRefs")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", id))
      .collect();
    await Promise.all(cellRefs.map((ref) => ctx.db.delete(ref._id)));

    await ctx.db.delete(id);
    return null;
  },
});
