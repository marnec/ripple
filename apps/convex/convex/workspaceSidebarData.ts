import { getAll } from "convex-helpers/server/relationships";
import { dmLabelForViewer } from "./lib/dmLabel";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";
import { channelKindSchema, channelVisibilitySchema } from "./schema";
import { ChannelKind, ChannelVisibility } from "@ripple/shared/enums";

import { isDirectMessage, isPublicChannel } from "@ripple/shared/channel";
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
    channels: v.array(
      v.object({
        _id: v.id("channels"),
        _creationTime: v.number(),
        name: v.string(),
        workspaceId: v.id("workspaces"),
        kind: channelKindSchema,
        visibility: channelVisibilitySchema,
        isHidden: v.boolean(),
      }),
    ),
    // Always reported regardless of `includeHidden` so the sidebar toggle
    // can render an accurate "N hidden" badge without a second query.
    hiddenChannelCount: v.number(),
  }),
  handler: async (ctx, { workspaceId, includeHidden = false }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Channels only. This query is mounted for the whole app shell, so every
    // table it touches joins the invalidation set of every connected member —
    // it used to `.collect()` the workspace's projects, documents, diagrams and
    // spreadsheets in full, which nothing in the sidebar rendered. The `#`
    // picker that did consume them is now on `nodes.suggest` / `tasks.suggest`,
    // and the breadcrumb resolves names via `breadcrumb.getResourceNames`.
    // Don't reintroduce a resource list here — add it to `nodes.suggest`.
    const [userChannelMemberships, publicChannels, userChannelStateRows] = await Promise.all([
      ctx.db
        .query("channelMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
        .collect(),
      ctx.db
        .query("channels")
        .withIndex("by_kind_visibility_workspace", (q) =>
          q
            .eq("kind", ChannelKind.CHANNEL)
            .eq("visibility", ChannelVisibility.PUBLIC)
            .eq("workspaceId", workspaceId),
        )
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
    // Dedupe by `_id` before sorting: the two sets are NOT disjoint.
    // `channelMembers.add` (`channelMembers.ts:107`) explicitly permits adding
    // someone to an OPEN channel, and `channels.approveJoinRequest` is a second
    // path to the same row — so such a channel arrives from both sides. Plain
    // concatenation rendered it twice (duplicate React keys) and let
    // `hiddenChannelCount` below count it twice.
    const byId = new Map<string, (typeof memberChannels)[number]>();
    for (const c of memberChannels) byId.set(c._id, c);
    for (const c of publicChannels) byId.set(c._id, c);
    const allChannels = [...byId.values()].sort(
      (a, b) => b._creationTime - a._creationTime,
    );

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
          if (isPublicChannel(c)) {
            isHidden = true;
          } else if (isDirectMessage(c)) {
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

        // A DM carries no stored label — it is derived from the participants,
        // and in a sidebar it is the *other* person, not "you × them".
        const name = isDirectMessage(c) ? await dmLabelForViewer(ctx, c._id, userId) : c.name;

        return {
          _id: c._id,
          _creationTime: c._creationTime,
          name,
          workspaceId: c.workspaceId,
          kind: c.kind,
          visibility: c.visibility,
          isHidden,
        };
      }),
    );

    const hiddenChannelCount = enrichedChannels.filter((c) => c.isHidden).length;
    const channels = includeHidden
      ? enrichedChannels
      : enrichedChannels.filter((c) => !c.isHidden);

    return {
      channels,
      hiddenChannelCount,
    };
  },
});
