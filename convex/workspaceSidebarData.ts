import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import {
  channelsByWorkspace,
  diagramsByWorkspace,
  documentsByWorkspace,
  membersByWorkspace,
  projectsByWorkspace,
  spreadsheetsByWorkspace
} from "./workspaceAggregates";

export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    projects: v.array(
      v.object({
        _id: v.id("projects"),
        _creationTime: v.number(),
        name: v.string(),
        color: v.string(),
        key: v.optional(v.string()),
      }),
    ),
    documents: v.array(
      v.object({
        _id: v.id("documents"),
        _creationTime: v.number(),
        name: v.string(),
        tags: v.optional(v.array(v.string())),
      }),
    ),
    diagrams: v.array(
      v.object({
        _id: v.id("diagrams"),
        _creationTime: v.number(),
        name: v.string(),
        tags: v.optional(v.array(v.string())),
      }),
    ),
    spreadsheets: v.array(
      v.object({
        _id: v.id("spreadsheets"),
        _creationTime: v.number(),
        name: v.string(),
        tags: v.optional(v.array(v.string())),
      }),
    ),
    counts: v.object({
      members: v.number(),
      channels: v.number(),
      projects: v.number(),
      documents: v.number(),
      diagrams: v.number(),
      spreadsheets: v.number(),
    }),
  }),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a workspace member");

    // Fetch lists for sidebar navigation (limited — only need recent items)
    const [projects, documents, diagrams, spreadsheets] =
      await Promise.all([
        ctx.db
          .query("projects")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect(),
        ctx.db
          .query("documents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect(),
        ctx.db
          .query("diagrams")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .collect(),
        ctx.db
          .query("spreadsheets")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .collect(),
      ]);

    // O(log n) aggregate counts — no full table scans
    const [membersCount, channelsCount, projectsCount, documentsCount, diagramsCount, spreadsheetsCount] =
      await Promise.all([
        membersByWorkspace.count(ctx, { namespace: workspaceId }),
        channelsByWorkspace.count(ctx, { namespace: workspaceId }),
        projectsByWorkspace.count(ctx, { namespace: workspaceId }),
        documentsByWorkspace.count(ctx, { namespace: workspaceId }),
        diagramsByWorkspace.count(ctx, { namespace: workspaceId }),
        spreadsheetsByWorkspace.count(ctx, { namespace: workspaceId }),
      ]);

    return {
      projects: projects.map((p) => ({
        _id: p._id,
        _creationTime: p._creationTime,
        name: p.name,
        color: p.color,
        key: p.key,
      })),
      documents: documents.map((d) => ({
        _id: d._id,
        _creationTime: d._creationTime,
        name: d.name,
        tags: d.tags,
      })),
      diagrams: diagrams.map((d) => ({
        _id: d._id,
        _creationTime: d._creationTime,
        name: d.name,
        tags: d.tags,
      })),
      spreadsheets: spreadsheets.map((s) => ({
        _id: s._id,
        _creationTime: s._creationTime,
        name: s.name,
        tags: s.tags,
      })),
      counts: {
        members: membersCount,
        channels: channelsCount,
        projects: projectsCount,
        documents: documentsCount,
        diagrams: diagramsCount,
        spreadsheets: spreadsheetsCount,
      },
    };
  },
});
