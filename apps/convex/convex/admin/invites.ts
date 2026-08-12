import { ConvexError, v } from "convex/values";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { internal } from "../_generated/api";
import { query } from "../_generated/server";
import { mutation } from "../functions";
import { logActivity } from "../auditLog";
import { sendWorkspaceInviteEmail } from "../emailDelivery";
import { emailDeliveryStatus } from "../schema";
import { requirePlatformAdmin } from "../authHelpers";

/**
 * Admin-only: every workspace invite ever issued, enriched with the workspace
 * it targets, who sent it, and whether the invited address already has an
 * account / is already a member (the two signals that explain a "stuck"
 * pending invite). Workspaces, users and memberships are each read once and
 * joined in memory — no per-invite N+1 — matching `admin/workspaces.list`.
 *
 * `siteUrl` rides along so the UI can offer copy-invite-link: the invite id
 * doubles as the token in `/invite/:id`, and handing an operator that link is
 * the usual fix when the invite email never lands. Null when SITE_URL isn't
 * configured on the deployment.
 *
 * Guard-first, so safe as a public query.
 */
export const list = query({
  args: {},
  returns: v.object({
    siteUrl: v.union(v.string(), v.null()),
    invites: v.array(
      v.object({
        _id: v.id("workspaceInvites"),
        createdAt: v.number(),
        email: v.string(),
        status: v.string(),
        workspaceId: v.id("workspaces"),
        workspaceName: v.union(v.string(), v.null()),
        invitedBy: v.id("users"),
        inviterName: v.optional(v.string()),
        inviterEmail: v.optional(v.string()),
        /** The account behind the invited address, if one exists yet. */
        recipientUserId: v.union(v.id("users"), v.null()),
        /** That account is already in the workspace — a pending invite here is stale. */
        recipientIsMember: v.boolean(),
        /**
         * The third explanation for a stuck invite, alongside the two above:
         * the mail never arrived. Absent on invites predating delivery tracking.
         */
        deliveryStatus: v.optional(emailDeliveryStatus),
        deliveryError: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    const [invites, workspaces, users, members] = await Promise.all([
      ctx.db.query("workspaceInvites").collect(),
      ctx.db.query("workspaces").collect(),
      ctx.db.query("users").collect(),
      ctx.db.query("workspaceMembers").collect(),
    ]);

    const workspaceById = new Map(workspaces.map((w) => [w._id as string, w]));
    const userById = new Map(users.map((u) => [u._id as string, u]));
    const userByEmail = new Map(
      users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]),
    );
    const membershipKeys = new Set(members.map((m) => `${m.workspaceId}:${m.userId}`));

    return {
      siteUrl: process.env.SITE_URL ?? null,
      invites: [...invites]
        .sort((a, b) => b._creationTime - a._creationTime)
        .map((invite) => {
          const inviter = userById.get(invite.invitedBy);
          const recipient = userByEmail.get(invite.email.toLowerCase());
          return {
            _id: invite._id,
            createdAt: invite._creationTime,
            email: invite.email,
            status: invite.status,
            workspaceId: invite.workspaceId,
            workspaceName: workspaceById.get(invite.workspaceId)?.name ?? null,
            invitedBy: invite.invitedBy,
            inviterName: inviter?.name,
            inviterEmail: inviter?.email,
            recipientUserId: recipient?._id ?? null,
            recipientIsMember: recipient
              ? membershipKeys.has(`${invite.workspaceId}:${recipient._id}`)
              : false,
            deliveryStatus: invite.deliveryStatus,
            deliveryError: invite.deliveryError,
          };
        }),
    };
  },
});

/**
 * Revoke any pending invite, from any workspace. Mirrors
 * `workspaceInvites.revoke` (delete the row, which invalidates the link:
 * `getPublic` returns null and `accept` throws) but authorizes on
 * platform-admin instead of workspace-admin — an operator handling a support
 * request is usually not a member of the workspace in question.
 *
 * Logged through `logActivity` rather than a bespoke admin audit action so the
 * entry lands in that workspace's timeline next to member-initiated revokes.
 */
export const revoke = mutation({
  args: { inviteId: v.id("workspaceInvites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const adminId = await requirePlatformAdmin(ctx);

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConvexError("Only pending invites can be revoked");
    }

    // Log before delete so the audit row still has the invite to reference.
    await logActivity(ctx, {
      userId: adminId,
      resourceType: "workspaceInvites",
      resourceId: inviteId,
      action: "revoked",
      oldValue: invite.email,
      resourceName: invite.email,
      scope: invite.workspaceId,
    });

    await ctx.db.delete(inviteId);
    return null;
  },
});

/**
 * Re-send the invite email for a pending invite. The mail keeps naming the
 * *original* inviter — the recipient knows them, not the operator — so this is
 * a redelivery, not a new invite from the admin.
 */
export const resend = mutation({
  args: { inviteId: v.id("workspaceInvites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const adminId = await requirePlatformAdmin(ctx);

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new ConvexError("Invite not found");
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConvexError("Only pending invites can be resent");
    }

    const workspace = await ctx.db.get(invite.workspaceId);
    if (!workspace) throw new ConvexError("Workspace no longer exists");
    const inviter = await ctx.db.get(invite.invitedBy);

    await sendWorkspaceInviteEmail(ctx, {
      inviteId,
      workspaceName: workspace.name,
      inviterName: inviter?.name ?? inviter?.email ?? "Someone",
      recipientEmail: invite.email,
    });

    await logActivity(ctx, {
      userId: adminId,
      resourceType: "workspaceInvites",
      resourceId: inviteId,
      action: "resent",
      newValue: invite.email,
      resourceName: invite.email,
      scope: invite.workspaceId,
    });

    return null;
  },
});
