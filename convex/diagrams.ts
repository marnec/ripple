import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
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

    return ctx.db.insert("diagrams", {
      workspaceId,
      name: diagramName,
      content: JSON.stringify({
        elements: [],
        appState: {
          viewBackgroundColor: "#ffffff",
        },
      }),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("diagrams"), name: v.string() },
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

    return ctx.db.patch(id, { name });
  },
});

export const updateContent = mutation({
  args: { 
    id: v.id("diagrams"), 
    content: v.string(),
  },
  handler: async (ctx, { id, content }) => {
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

    const newScene = JSON.parse(content);
    const existingScene = JSON.parse(
      diagram.content || '{"elements": [], "appState": {}}',
    );

    const existingElements = Array.isArray(existingScene.elements)
      ? existingScene.elements
      : [];

    const existingElementsMap = new Map(
      existingElements.map((el: any) => [el.id, el]),
    );

    const newElements = Array.isArray(newScene.elements)
      ? newScene.elements
      : [];

    for (const element of newElements) {
      existingElementsMap.set(element.id, element);
    }

    const mergedElements = Array.from(existingElementsMap.values());

    const mergedScene = {
      elements: mergedElements,
      appState: {
        ...(existingScene.appState || {}),
        ...(newScene.appState || {}),
      },
    };

    return ctx.db.patch(id, { content: JSON.stringify(mergedScene) });
  },
});

export const remove = mutation({
  args: { id: v.id("diagrams") },
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

    return ctx.db.delete(id);
  },
}); 