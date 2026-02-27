import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { WorkspaceRole } from "@shared/enums/roles";
import { InviteStatus } from "@shared/enums/inviteStatus";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
  },
  handler: async (ctx, { workspaceId, email }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check if user is admin of workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user_and_role", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId).eq("role", WorkspaceRole.ADMIN),
      )
      .first();

    if (!membership) throw new ConvexError("Not authorized to invite users");

    // Check if invite already exists
    const existingInvite = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_workspace_by_email_by_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("email", email).eq("status", InviteStatus.PENDING),
      )
      .first();

    if (existingInvite) throw new ConvexError("Invite already sent");

    // Check if user is already a member
    const existingMember = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (existingMember) {
      const isMember = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", existingMember._id),
        )
        .first();

      if (isMember) throw new ConvexError("User is already a member");
    }

    // Get workspace details for the email
    const workspace = await ctx.db.get(workspaceId);
    const inviter = await ctx.db.get(userId);

    // Create the invite
    const inviteId = await ctx.db.insert("workspaceInvites", {
      workspaceId,
      email,
      invitedBy: userId,
      status: InviteStatus.PENDING,
    });

    // Send invite email
    await ctx.scheduler.runAfter(0, internal.emails.sendWorkspaceInvite, {
      inviteId,
      workspaceName: workspace!.name,
      inviterName: inviter!.name ?? inviter!.email!,
      recipientEmail: email,
    });

    return inviteId;
  },
});

export const listByEmail = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("workspaceInvites"),
    _creationTime: v.number(),
    workspaceId: v.id("workspaces"),
    email: v.string(),
    invitedBy: v.id("users"),
    status: v.string(),
    workspace: v.union(v.object({
      _id: v.id("workspaces"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      ownerId: v.id("users"),
    }), v.null()),
    inviterName: v.string(),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db.get(userId);
    if (!user) return [];

    const { email } = user;

    if (!email) return [];

    const invites = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", InviteStatus.PENDING),
      )

      .collect();

    return Promise.all(
      invites.map(async (invite) => {
        const workspace = await ctx.db.get(invite.workspaceId);
        const inviter = await ctx.db.get(invite.invitedBy);
        return {
          ...invite,
          workspace,
          inviterName: inviter?.name ?? inviter?.email ?? "Someone",
        };
      }),
    );
  },
});

export const accept = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  handler: async (ctx, { inviteId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");

    const user = await ctx.db.get(userId);
    if (!user?.email || user.email !== invite.email) {
      throw new ConvexError("Not authorized to accept this invite");
    }

    // Check if the user is already a member of the workspace
    const existingMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", invite.workspaceId).eq("userId", userId),
      )
      .first();

    if (existingMembership) {
      throw new ConvexError("User is already a member of this workspace");
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

export const decline = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");

    const user = await ctx.db.get(userId);
    if (!user?.email || user.email !== invite.email) {
      throw new ConvexError("Not authorized to decline this invite");
    }

    await ctx.db.patch(inviteId, {
      status: InviteStatus.DECLINED,
    });
  },
});
