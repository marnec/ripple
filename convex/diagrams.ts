import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DiagramRole } from "@shared/enums";

const diagramValidator = v.object({
  _id: v.id("diagrams"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
  yjsSnapshotId: v.optional(v.id("_storage")),
  svgPreview: v.optional(v.string()),
  roleCount: v.optional(v.object({
    admin: v.number(),
    member: v.number(),
  })),
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(diagramValidator),
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
      .query("diagrams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("diagrams") },
  returns: v.union(diagramValidator, v.null()),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) return null;

    const diagram = await ctx.db.get(id);

    if (!diagram) return null;

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", diagram.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership) return null;

    return diagram;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
  },
  returns: v.id("diagrams"),
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

    // Generate a default name if none provided
    const diagramCount = await ctx.db
      .query("diagrams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .then(diagrams => diagrams.length);

    const diagramName = name || `Diagram ${diagramCount + 1}`;

    const diagramId = await ctx.db.insert("diagrams", {
      workspaceId,
      name: diagramName,
      roleCount: {
        [DiagramRole.ADMIN]: 1,
        [DiagramRole.MEMBER]: 0,
      },
    });

    await ctx.db.insert("diagramMembers", {
      diagramId,
      userId,
      role: DiagramRole.ADMIN,
    });

    return diagramId;
  },
});

export const rename = mutation({
  args: { id: v.id("diagrams"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(id);

    if (!diagram) throw new ConvexError("Diagram not found");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", diagram.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${diagram.workspaceId}"`,
      );

    await ctx.db.patch(id, { name });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("diagrams") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(id);

    if (!diagram) throw new ConvexError("Diagram not found");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", diagram.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${diagram.workspaceId}"`,
      );

    await ctx.db.delete(id);
    return null;
  },
});

export const updateSvgPreview = mutation({
  args: {
    id: v.id("diagrams"),
    svgPreview: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, svgPreview }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(id);
    if (!diagram) throw new ConvexError("Diagram not found");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", diagram.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${diagram.workspaceId}"`,
      );

    await ctx.db.patch(id, { svgPreview });
    return null;
  },
}); 