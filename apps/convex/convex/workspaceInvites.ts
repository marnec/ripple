import { ConvexError, v } from "convex/values";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { logActivity } from "./auditLog";
import { sendWorkspaceInviteEmail } from "./emailDelivery";
import { emailDeliveryStatus } from "./schema";
import { requireWorkspaceMember, requireUser, getUser } from "./authHelpers";
import type { Doc } from "./_generated/dataModel";

/**
 * An invite is single-use. Every transition out of PENDING is terminal, so
 * each mutation that consumes one asserts the state first — otherwise the row
 * outlives its purpose as a replayable credential.
 */
function assertPending(invite: Doc<"workspaceInvites">, action: string): void {
  if (invite.status !== InviteStatus.PENDING) {
    throw new ConvexError(`This invite has already been ${invite.status} and cannot be ${action}ed`);
  }
}

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
  },
  // Under static codegen a missing validator yields literal `any` on the
  // client; every other function in this file declares one.
  returns: v.id("workspaceInvites"),
  handler: async (ctx, { workspaceId, email }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId, { role: WorkspaceRole.ADMIN });

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

    await logActivity(ctx, {
      userId, resourceType: "workspaceInvites", resourceId: inviteId,
      action: "invited", newValue: email, resourceName: email, scope: workspaceId,
    });

    // Enqueue the invite email. Durable and in this transaction — see
    // `emailDelivery.ts`; the old scheduled action ran at most once.
    await sendWorkspaceInviteEmail(ctx, {
      inviteId,
      workspaceName: workspace!.name,
      inviterName: inviter!.name ?? inviter!.email!,
      recipientEmail: email,
    });

    return inviteId;
  },
});

export const getPublic = query({
  args: {
    inviteId: v.string(),
  },
  returns: v.union(
    v.object({
      email: v.string(),
      workspaceName: v.string(),
      inviterName: v.string(),
      status: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { inviteId }) => {
    // The invite id doubles as the secret token in the URL; anyone holding it
    // already received the invite email, so exposing the bound email is safe
    // and lets the sign-up form lock it. Normalize defensively for bad tokens.
    const normalizedId = ctx.db.normalizeId("workspaceInvites", inviteId);
    if (!normalizedId) return null;

    const invite = await ctx.db.get(normalizedId);
    if (!invite) return null;

    const workspace = await ctx.db.get(invite.workspaceId);
    const inviter = await ctx.db.get(invite.invitedBy);

    return {
      email: invite.email,
      workspaceName: workspace?.name ?? "a workspace",
      inviterName: inviter?.name ?? inviter?.email ?? "Someone",
      status: invite.status,
    };
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
    const userId = await getUser(ctx);
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
        // Projected field by field rather than spread: the row also carries the
        // Resend delivery columns (`deliveryEmailId`, `deliveryStatus`,
        // `deliveryError`), and this is the *invitee's* view. Those belong to
        // the admin's `listByWorkspace` — an internal correlation id and raw
        // provider error text are not the recipient's business, and spreading
        // them here also fails the return validator, which takes the whole
        // pending-invite banner down.
        return {
          _id: invite._id,
          _creationTime: invite._creationTime,
          workspaceId: invite.workspaceId,
          email: invite.email,
          invitedBy: invite.invitedBy,
          status: invite.status,
          workspace,
          inviterName: inviter?.name ?? inviter?.email ?? "Someone",
        };
      }),
    );
  },
});

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  returns: v.array(
    v.object({
      _id: v.id("workspaceInvites"),
      _creationTime: v.number(),
      email: v.string(),
      invitedBy: v.id("users"),
      inviterName: v.string(),
      // A pending invite whose mail bounced is indistinguishable from one the
      // recipient simply hasn't answered — this is what tells them apart.
      // Absent on invites predating the delivery-tracking work.
      deliveryStatus: v.optional(emailDeliveryStatus),
      deliveryError: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId, { role: WorkspaceRole.ADMIN });

    const invites = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_workspace_by_email_by_status", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .collect();

    const pending = invites.filter((i) => i.status === InviteStatus.PENDING);

    return Promise.all(
      pending.map(async (invite) => {
        const inviter = await ctx.db.get(invite.invitedBy);
        return {
          _id: invite._id,
          _creationTime: invite._creationTime,
          email: invite.email,
          invitedBy: invite.invitedBy,
          inviterName: inviter?.name ?? inviter?.email ?? "Someone",
          deliveryStatus: invite.deliveryStatus,
          deliveryError: invite.deliveryError,
        };
      }),
    );
  },
});

export const revoke = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");

    const { userId } = await requireWorkspaceMember(ctx, invite.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (invite.status !== InviteStatus.PENDING) {
      throw new ConvexError("Only pending invites can be revoked");
    }

    // Log before delete so the audit row still has the invite to reference.
    await logActivity(ctx, {
      userId, resourceType: "workspaceInvites", resourceId: inviteId,
      action: "revoked", oldValue: invite.email, resourceName: invite.email,
      scope: invite.workspaceId,
    });

    // Deleting the row invalidates the invite link: `getPublic` returns null
    // and `accept` throws "Invite not found".
    await ctx.db.delete(inviteId);

    return null;
  },
});

export const resend = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");

    const { userId } = await requireWorkspaceMember(ctx, invite.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (invite.status !== InviteStatus.PENDING) {
      throw new ConvexError("Only pending invites can be resent");
    }

    const workspace = await ctx.db.get(invite.workspaceId);
    const inviter = await ctx.db.get(userId);

    await sendWorkspaceInviteEmail(ctx, {
      inviteId,
      workspaceName: workspace!.name,
      inviterName: inviter!.name ?? inviter!.email!,
      recipientEmail: invite.email,
    });

    await logActivity(ctx, {
      userId, resourceType: "workspaceInvites", resourceId: inviteId,
      action: "resent", newValue: invite.email, resourceName: invite.email,
      scope: invite.workspaceId,
    });

    return null;
  },
});

export const accept = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const userId = await requireUser(ctx);

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");

    // Without this, an ACCEPTED row is a permanent re-entry credential: member
    // removal (`workspaceMembers.removeMembershipCascade`) never touches the
    // invites table, so a removed member could simply replay the same
    // inviteId. `revoke` and `resend` have always guarded on PENDING.
    assertPending(invite, "accept");

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

    await logActivity(ctx, {
      userId, resourceType: "workspaceInvites", resourceId: inviteId,
      action: "accepted", scope: invite.workspaceId,
    });
  },
});

export const decline = mutation({
  args: {
    inviteId: v.id("workspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const userId = await requireUser(ctx);

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");
    assertPending(invite, "decline");

    const user = await ctx.db.get(userId);
    if (!user?.email || user.email !== invite.email) {
      throw new ConvexError("Not authorized to decline this invite");
    }

    await ctx.db.patch(inviteId, {
      status: InviteStatus.DECLINED,
    });

    await logActivity(ctx, {
      userId, resourceType: "workspaceInvites", resourceId: inviteId,
      action: "declined", scope: invite.workspaceId,
    });

    return null;
  },
});
