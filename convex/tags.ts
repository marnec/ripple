import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";

export const listWorkspaceTags = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const tagSet = new Set<string>();

    const tables = ["documents", "diagrams", "spreadsheets", "projects"] as const;

    for (const table of tables) {
      const resources = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const resource of resources) {
        if ("tags" in resource && resource.tags) {
          for (const tag of resource.tags) {
            tagSet.add(tag);
          }
        }
      }
    }

    return [...tagSet].sort();
  },
});
