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

    // Mirrors taskStatuses.listByProject: a row draining its joins is already
    // retired, so it must not be offered back to the picker that would re-apply it.
    return dictionary
      .filter((t) => t.pendingDeletion !== true)
      .map((t) => t.name)
      .sort();
  },
});
