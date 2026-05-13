import { getAll } from "convex-helpers/server/relationships";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";
import { channelTypeSchema } from "./schema";

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    // When true, include channels the user has hidden (still flagged
    // `isHidden: true` so the client can render them differently). Used by
    // the "Show hidden" sidebar toggle. Defaults to false — the sidebar
    // filters hidden channels out server-side to keep the payload tight.
    includeHidden: v.optional(v.boolean()),
  },
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
        isHidden: v.boolean(),
      }),
    ),
    // Always reported regardless of `includeHidden` so the sidebar toggle
    // can render an accurate "N hidden" badge without a second query.
    hiddenChannelCount: v.number(),
  }),
  handler: async (ctx, { workspaceId, includeHidden = false }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Fetch lists for sidebar navigation (limited — only need recent items)
    const [
      projects,
      documents,
      diagrams,
      spreadsheets,
      userChannelMemberships,
      publicChannels,
      userChannelStateRows,
    ] = await Promise.all([
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
      ctx.db
        .query("userChannelState")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
        .collect(),
    ]);

    // Resolve closed/dm channels from memberships + merge with open channels
    const memberChannelIds = userChannelMemberships.map((m) => m.channelId);
    const memberChannels = (await getAll(ctx.db, memberChannelIds))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const allChannels = [...memberChannels, ...publicChannels]
      .sort((a, b) => b._creationTime - a._creationTime);

    // Map channelId → hiddenAt for cheap lookup.
    const hiddenAtByChannelId = new Map<string, number>();
    for (const s of userChannelStateRows) {
      if (s.hiddenAt !== undefined) hiddenAtByChannelId.set(s.channelId, s.hiddenAt);
    }

    // Compute isHidden per channel. For DMs the answer depends on whether a
    // message has arrived after `hiddenAt` (auto-unhide). For opens any
    // `hiddenAt` value means hidden. Closed channels never hide (they leave).
    const enrichedChannels = await Promise.all(
      allChannels.map(async (c) => {
        const hiddenAt = hiddenAtByChannelId.get(c._id);
        let isHidden = false;
        if (hiddenAt !== undefined) {
          if (c.type === "open") {
            isHidden = true;
          } else if (c.type === "dm") {
            // Only DMs with a hide flag pay the latest-message lookup. Single
            // indexed read; bounded by the user's hidden-DM count.
            const latestMessage = await ctx.db
              .query("messages")
              .withIndex("by_channel", (q) => q.eq("channelId", c._id))
              .order("desc")
              .first();
            isHidden = !latestMessage || latestMessage._creationTime <= hiddenAt;
          }
          // closed: isHidden stays false
        }

        // Resolve DM display name from the other member if the channel has none.
        let name = c.name;
        if (c.type === "dm" && !name) {
          const dmMembers = await ctx.db
            .query("channelMembers")
            .withIndex("by_channel", (q) => q.eq("channelId", c._id))
            .collect();
          const otherMember = dmMembers.find((m) => m.userId !== userId);
          if (otherMember?.name) {
            name = otherMember.name;
          }
        }

        return {
          _id: c._id,
          _creationTime: c._creationTime,
          name,
          workspaceId: c.workspaceId,
          type: c.type,
          isHidden,
        };
      }),
    );

    const hiddenChannelCount = enrichedChannels.filter((c) => c.isHidden).length;
    const channels = includeHidden
      ? enrichedChannels
      : enrichedChannels.filter((c) => !c.isHidden);

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
      channels,
      hiddenChannelCount,
    };
  },
});
