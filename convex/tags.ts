import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";

export const listWorkspaceTags = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

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
