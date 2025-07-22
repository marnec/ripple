import { getAuthUserId } from "@convex-dev/auth/server";
import { ChannelRole } from "@shared/enums";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ChannelMember } from "@shared/types/channel";
import { channelRoleSchema } from "./schema";

export const byChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Unauthenticated");

    return ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
  },
});

export const membersByChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Unauthenticated");

    const members = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();

    return Promise.all(
      members.map((member) => {
        return ctx.db.get(member.userId).then((user) => {
          if (!user) return null;
          return { ...member, name: user.name ?? user.email ?? "unknown" } satisfies ChannelMember;
        });
      }),
    ).then((users) => users.filter((u) => u !== null));
  },
});

export const addToChannel = mutation({
  args: { userId: v.id("users"), channelId: v.id("channels")},
  handler: async (ctx, { userId, channelId }) => {
    const channelMemberExists = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    if (channelMemberExists) {
      throw new ConvexError(`User id=${userId} is already a member of channel id=${channelId}`);
    }

    const channel = await ctx.db.get(channelId);

    if (!channel) {
      throw new ConvexError(`Channel ${channelId} does not exist`);
    }

    const { member } = channel.roleCount;

    await ctx.db.patch(channelId, {
      roleCount: { ...channel.roleCount, [ChannelRole.MEMBER]: member + 1 },
    });

    return ctx.db.insert("channelMembers", {
      userId,
      channelId,
      workspaceId: channel.workspaceId,
      role: ChannelRole.MEMBER,
    });
  },
});

export const removeFromChannel = mutation({
  args: { userId: v.id("users"), channelId: v.id("channels") },
  handler: async (ctx, { userId, channelId }) => {
    const channelMember = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    if (!channelMember) {
      throw new ConvexError(`User id=${userId} is not part of channel id=${channelId}`);
    }

    const channel = await ctx.db.get(channelId);
    const user = await ctx.db.get(userId);

    if (!channel) {
      throw new ConvexError(`Channel not found with id=${channelId}`);
    }

    if (!user) {
      throw new ConvexError(`User not found with id=${userId}`);
    }

    const numberRoleInChannel = channel.roleCount[`${channelMember.role}`];

    if (numberRoleInChannel === 0) {
      throw new ConvexError(
        `Something went wrong: There are 0 ${channelMember.role}s before removal`,
      );
    }

    if (channelMember.role === ChannelRole.ADMIN && numberRoleInChannel === 1) {
      throw new ConvexError(
        `Cannot remove last ${ChannelRole.ADMIN} in the channel, set another user as admin first`,
      );
    }

    await ctx.db.patch(channelId, {
      roleCount: {
        ...channel.roleCount,
        [channelMember.role]: channel.roleCount[`${channelMember.role}`] - 1,
      },
    });

    return ctx.db.delete(channelMember._id);
  },
});

export const changeMemberRole = mutation({
  args: { channelMemberId: v.id("channelMembers"), role: channelRoleSchema },
  handler: async (ctx, { channelMemberId, role }) => {
    const channelMember = await ctx.db.get(channelMemberId);

    if (!channelMember) {
      throw new ConvexError(`No channel member found with id=${channelMemberId}`);
    }

    if (channelMember.role === role) return;

    if (channelMember.role === "admin") {
      const channelAdmins = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_role", (q) =>
          q.eq("channelId", channelMember.channelId).eq("role", "admin"),
        )
        .collect();

      if (channelAdmins.length <= 1) {
        throw new ConvexError(
          `Cannot remove last ${ChannelRole.ADMIN} in the channel, set another user as admin first`,
        );
      }
    }

    return ctx.db.patch(channelMemberId, { role });
  },
});
