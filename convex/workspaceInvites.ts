import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { WorkspaceRole } from "shared/enums/roles";
import { InviteStatus } from "shared/enums/inviteStatus";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
  },
  handler: async (ctx, { workspaceId, email }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin of workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.and(
        q.eq(q.field("workspaceId"), workspaceId),
        q.eq(q.field("userId"), userId),
        q.eq(q.field("role"), WorkspaceRole.ADMIN)
      ))
      .first();

    if (!membership) throw new Error("Not authorized to invite users");

    // Check if invite already exists
    const existingInvite = await ctx.db
      .query("workspaceInvites")
      .filter(q => q.and(
        q.eq(q.field("workspaceId"), workspaceId),
        q.eq(q.field("email"), email),
        q.eq(q.field("status"), InviteStatus.PENDING)
      ))
      .first();

    if (existingInvite) throw new Error("Invite already sent");

    // Check if user is already a member
    const existingMember = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("email"), email))
      .first();

    if (existingMember) {
      const isMember = await ctx.db
        .query("workspaceMembers")
        .filter(q => q.and(
          q.eq(q.field("workspaceId"), workspaceId),
          q.eq(q.field("userId"), existingMember._id)
        ))
        .first();

      if (isMember) throw new Error("User is already a member");
    }

    return await ctx.db.insert("workspaceInvites", {
      workspaceId,
      email,
      invitedBy: userId,
      status: InviteStatus.PENDING,
    });
  },
});

export const listByEmail = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db.get(userId);
    if (!user?.email) return [];

    const invites = await ctx.db
      .query("workspaceInvites")
      .filter(q => q.and(
        q.eq(q.field("email"), user.email),
        q.eq(q.field("status"), InviteStatus.PENDING)
      ))
      .collect();

    return Promise.all(
      invites.map(async (invite) => {
        const workspace = await ctx.db.get(invite.workspaceId);
        return {
          ...invite,
          workspace
        };
      })
    );
  },
});

export const accept = mutation({
  args: {
    inviteId: v.id("workspaceInvites")
  },
  handler: async (ctx, { inviteId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite not found");

    const user = await ctx.db.get(userId);
    if (!user?.email || user.email !== invite.email) {
      throw new Error("Not authorized to accept this invite");
    }

    // Add user to workspace members
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: invite.workspaceId,
      role: WorkspaceRole.MEMBER,
    });

    // Update invite status
    await ctx.db.patch(inviteId, {
      status: InviteStatus.ACCEPTED,
    });
  },
}); 