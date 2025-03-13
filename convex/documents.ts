import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_DOC_NAME } from "@shared/constants";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const match = await ctx.db
      .query("documents")
      .withSearchIndex("by_name", (q) =>
        q.search("name", DEFAULT_DOC_NAME).eq("workspaceId", workspaceId),
      )
      .collect();

    const lastUntitledCount =
      match
        .map(({ name }) => parseInt(name.split("_").at(1) || ""))
        .filter(Boolean)
        .sort((a, b) => b - a)
        .at(0) || 0;

    return ctx.db.insert("documents", {
      workspaceId,
      name: `${DEFAULT_DOC_NAME}_${lastUntitledCount + 1}`,
    });
  },
});

export const rename = mutation({
  args: {
    id: v.id("documents"),
    name: v.string(),
  },
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

    const match = await ctx.db
      .query("documents")
      .withSearchIndex("by_name", (q) =>
        q.search("name", name).eq("workspaceId", document.workspaceId),
      )
      .collect();

    if (match.length) throw new ConvexError("Document name already exists");

    return ctx.db.patch(id, { name });
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return ctx.db
      .query("documents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

    return ctx.db.delete(id);
  },
});
