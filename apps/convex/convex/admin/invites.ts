import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { query } from "../_generated/server";
import { mutation } from "../functions";
import { logActivity } from "../auditLog";
import { sendWorkspaceInviteEmail } from "../emailDelivery";
import { emailDeliveryStatus } from "../schema";
import { requirePlatformAdmin } from "../authHelpers";
import { rateLimiter } from "../rateLimits";

/**
 * Mirrors the `status` column's own union in `schema.ts`. Declared as literals
 * rather than `v.string()` so `withIndex("by_status", …)` type-checks against
 * the index's key type — a plain string arg would not.
 */
const inviteStatusValidator = v.union(
  ...Object.values(InviteStatus).map((status) => v.literal(status)),
);

/**
 * The invite id doubles as the token in `/invite/:id`, so handing an operator
 * that link is the usual fix when the invite email never lands. This used to
 * ride along on `list`, which can no longer carry it: a paginated query has to
 * return the `PaginationResult` shape and nothing else. Null when SITE_URL
 * isn't configured on the deployment.
 */
export const siteUrl = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return process.env.SITE_URL ?? null;
  },
});

/**
 * Admin-only: workspace invites newest-first, enriched with the workspace they
 * target, who sent them, and whether the invited address already has an account
 * / is already a member (the two signals that explain a "stuck" pending
 * invite). Guard-first, so safe as a public query.
 *
 * Paginated, and `status` filters on the server via the `by_status` index
 * rather than in the client. Both halves of that matter: the previous shape
 * read `workspaceInvites`, `workspaces`, `users` and `workspaceMembers` whole
 * on every invalidation, and paginating alone would have left the console's
 * status tabs filtering one loaded page — so an operator hunting a stuck
 * pending invite would have had to page through accepted ones to reach it.
 *
 * The per-invite enrichment below is a deliberate N+1: every leg is a point
 * read or an index lookup, and the page bounds how many of them run.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    /** Omit for "all statuses". */
    status: v.optional(inviteStatusValidator),
  },
  returns: v.object({
    page: v.array(
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
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts, status }) => {
    await requirePlatformAdmin(ctx);

    const result = await (status === undefined
      ? ctx.db.query("workspaceInvites").order("desc")
      : ctx.db
          .query("workspaceInvites")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
    ).paginate(paginationOpts);

    const page = await Promise.all(
      result.page.map(async (invite) => {
        const [workspace, inviter, recipient] = await Promise.all([
          ctx.db.get(invite.workspaceId),
          ctx.db.get(invite.invitedBy),
          // `.first()`, not `.unique()`: account-linking has historically left
          // duplicate rows for one address, and a throw here would blank the
          // whole page over a cosmetic column. Same shape as the lookup in
          // `workspaceInvites.create`.
          ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", invite.email.toLowerCase()))
            .first(),
        ]);

        // Only worth asking once we know who the recipient is; `by_workspace_user`
        // makes it a point lookup rather than a scan of the workspace's roster.
        const membership = recipient
          ? await ctx.db
              .query("workspaceMembers")
              .withIndex("by_workspace_user", (q) =>
                q.eq("workspaceId", invite.workspaceId).eq("userId", recipient._id),
              )
              .first()
          : null;

        return {
          _id: invite._id,
          createdAt: invite._creationTime,
          email: invite.email,
          status: invite.status,
          workspaceId: invite.workspaceId,
          workspaceName: workspace?.name ?? null,
          invitedBy: invite.invitedBy,
          inviterName: inviter?.name,
          inviterEmail: inviter?.email,
          recipientUserId: recipient?._id ?? null,
          recipientIsMember: membership !== null,
          deliveryStatus: invite.deliveryStatus,
          deliveryError: invite.deliveryError,
        };
      }),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
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

    // Same per-invite bucket the workspace-facing `resend` takes, and
    // deliberately the SAME key: the limit protects the recipient's inbox and
    // the sending domain's reputation, and neither cares which of the two
    // surfaces pressed the button. A platform admin who genuinely needs to
    // exceed it is one hour away, which is the right amount of friction for a
    // mail send to a third party.
    await rateLimiter.limit(ctx, "workspaceInviteResend", {
      key: inviteId,
      throws: true,
    });

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
