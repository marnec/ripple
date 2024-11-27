import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    return ctx.db
      .query("workspaceMembers")
      .filter((q) => q.eq(q.field("workspaceId"), workspaceId))
      .collect();
  },
});
