import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";

export const listWorkspaceTags = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const dictionary = await ctx.db
      .query("tags")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return dictionary.map((t) => t.name).sort();
  },
});
