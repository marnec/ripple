import { getAll } from "convex-helpers/server/relationships";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";
import { channelTypeSchema } from "./schema";
import { getUserDisplayName } from "@shared/displayName";

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
    channels: v.array(
      v.object({
        _id: v.id("channels"),
        _creationTime: v.number(),
        name: v.string(),
        workspaceId: v.id("workspaces"),
        type: channelTypeSchema,
      }),
    ),
  }),
  handler: async (ctx, { workspaceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Fetch lists for sidebar navigation (limited — only need recent items)
    const [projects, documents, diagrams, spreadsheets, userChannelMemberships, publicChannels] =
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
        ctx.db
          .query("channelMembers")
          .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
          .collect(),
        ctx.db
          .query("channels")
          .withIndex("by_type_workspace", (q) => q.eq("type", "open").eq("workspaceId", workspaceId))
          .collect(),
      ]);

    // Resolve closed/dm channels from memberships + merge with open channels
    const memberChannelIds = userChannelMemberships.map((m) => m.channelId);
    const memberChannels = (await getAll(ctx.db, memberChannelIds))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const allChannels = [...memberChannels, ...publicChannels]
      .sort((a, b) => b._creationTime - a._creationTime);

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
      channels: await Promise.all(allChannels.map(async (raw) => {
        // TODO(channel-type-migration): drop the `legacy.isPublic` fallback after
        // running `migrations:migrateChannelIsPublicToType` in prod. Replace with
        // `const type = raw.type;` once the schema guarantees it.
        const legacy = raw as Record<string, unknown>;
        const type = raw.type ?? (legacy.isPublic === false ? "closed" as const : "open" as const);
        const c = { ...raw, type };
        let name = c.name;
        if (c.type === "dm" && !name) {
          // Resolve the other participant's name for DMs
          const dmMembers = await ctx.db
            .query("channelMembers")
            .withIndex("by_channel", (q) => q.eq("channelId", c._id))
            .collect();
          const otherMember = dmMembers.find((m) => m.userId !== userId);
          if (otherMember) {
            const otherUser = await ctx.db.get(otherMember.userId);
            name = otherUser ? getUserDisplayName(otherUser) : "Unknown";
          }
        }
        return {
          _id: c._id,
          _creationTime: c._creationTime,
          name,
          workspaceId: c.workspaceId,
          type: c.type,
        };
      })),
    };
  },
});
