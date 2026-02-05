import { v } from "convex/values";
import { query } from "./_generated/server";

export const getResourceName = query({
  args: {
    resourceId: v.union(v.id("workspaces"), v.id("channels"), v.id("projects"), v.id("documents"), v.id("diagrams")),
  },
  handler: async (ctx, { resourceId }) => {
    const resource = await ctx.db.get(resourceId);

    return resource?.name;
  },
});
