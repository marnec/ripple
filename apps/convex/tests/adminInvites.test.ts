import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { describe, expect, it } from "vitest";
import type { EmailId } from "@convex-dev/resend";
import { api } from "../convex/_generated/api";
import { readEmail } from "../convex/emailDelivery";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "ops@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

async function insertInvite(
  t: T,
  args: {
    workspaceId: Id<"workspaces">;
    invitedBy: Id<"users">;
    email: string;
    status?: (typeof InviteStatus)[keyof typeof InviteStatus];
  },
) {
  return t.run((ctx) =>
    ctx.db.insert("workspaceInvites", {
      workspaceId: args.workspaceId,
      email: args.email,
      invitedBy: args.invitedBy,
      status: args.status ?? InviteStatus.PENDING,
    }),
  );
}

/**
 * The invite email is no longer a scheduled action to grep for in
 * `_scheduled_functions` — it is enqueued into `@convex-dev/resend` inside the
 * mutation's own transaction, and the invite row carries the component's email
 * id. So the observable is the queued email itself: recipient, subject, and the
 * rendered body (which is where the inviter's name now lives, since rendering
 * happens at enqueue time rather than inside a send action).
 */
async function queuedInviteEmail(t: T, inviteId: Id<"workspaceInvites">) {
  return await t.run(async (ctx) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite?.deliveryEmailId) return null;
    return await readEmail(ctx, invite.deliveryEmailId as EmailId);
  });
}

describe("admin.invites.list", () => {
  /**
   * The console's own reason for existing is explaining a stuck invite — it
   * already surfaces "the address has an account" and "that account is already
   * a member". A bounced email is the third explanation, and was the missing one.
   */
  it("carries the delivery state of each invite", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "typo@example.com",
        invitedBy: ownerId,
        status: InviteStatus.PENDING,
        deliveryEmailId: "email-1",
        deliveryStatus: "bounced",
        deliveryError: "The recipient's mailbox does not exist.",
      });
    });

    const { asAdmin } = await makePlatformAdmin(t);
    const { invites } = await asAdmin.query(api.admin.invites.list, {});

    expect(invites[0]).toMatchObject({
      email: "typo@example.com",
      deliveryStatus: "bounced",
      deliveryError: "The recipient's mailbox does not exist.",
    });
  });

  it("returns every invite regardless of status, newest first, enriched", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");

    await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "old@example.com", status: InviteStatus.DECLINED });
    await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "new@example.com" });

    const { asAdmin } = await makePlatformAdmin(t);
    const { invites } = await asAdmin.query(api.admin.invites.list, {});

    expect(invites.map((i) => i.email)).toEqual(["new@example.com", "old@example.com"]);
    expect(invites[0]).toMatchObject({
      status: InviteStatus.PENDING,
      workspaceName: "Acme",
      inviterName: "Test User",
      recipientUserId: null,
      recipientIsMember: false,
    });
  });

  it("flags an invited address that already has an account and is already a member", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);

    // Case differs from the invite to prove matching is case-insensitive.
    const memberId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Mia", email: "mia@example.com" });
      await ctx.db.insert("workspaceMembers", { userId: id, workspaceId, role: WorkspaceRole.MEMBER });
      return id;
    });
    await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "Mia@Example.com" });
    // Same account, different workspace → has an account but is not a member there.
    const otherWorkspaceId = await t.run((ctx) =>
      ctx.db.insert("workspaces", { name: "Other", ownerId }),
    );
    await insertInvite(t, { workspaceId: otherWorkspaceId, invitedBy: ownerId, email: "mia@example.com" });

    const { asAdmin } = await makePlatformAdmin(t);
    const { invites } = await asAdmin.query(api.admin.invites.list, {});

    const inAcme = invites.find((i) => i.workspaceId === workspaceId);
    const inOther = invites.find((i) => i.workspaceId === otherWorkspaceId);
    expect(inAcme).toMatchObject({ recipientUserId: memberId, recipientIsMember: true });
    expect(inOther).toMatchObject({ recipientUserId: memberId, recipientIsMember: false });
  });

  it("rejects a signed-in user who isn't a platform admin", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);

    await expect(asUser.query(api.admin.invites.list, {})).rejects.toThrow(/Not authorized/);
  });
});

describe("admin.invites.revoke", () => {
  it("deletes a pending invite from a workspace the admin isn't a member of", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const inviteId = await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "x@example.com" });

    const { asAdmin } = await makePlatformAdmin(t);
    await asAdmin.mutation(api.admin.invites.revoke, { inviteId });

    expect(await t.run((ctx) => ctx.db.get(inviteId))).toBeNull();
  });

  it("refuses to revoke an invite that is no longer pending", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const inviteId = await insertInvite(t, {
      workspaceId,
      invitedBy: ownerId,
      email: "x@example.com",
      status: InviteStatus.ACCEPTED,
    });

    const { asAdmin } = await makePlatformAdmin(t);
    await expect(
      asAdmin.mutation(api.admin.invites.revoke, { inviteId }),
    ).rejects.toThrow(/Only pending invites/);
    expect(await t.run((ctx) => ctx.db.get(inviteId))).not.toBeNull();
  });

  it("rejects a non-admin caller", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const inviteId = await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "x@example.com" });

    await expect(
      asUser.mutation(api.admin.invites.revoke, { inviteId }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("admin.invites.resend", () => {
  it("schedules the invite email, still crediting the original inviter", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");
    const inviteId = await insertInvite(t, { workspaceId, invitedBy: ownerId, email: "x@example.com" });

    const { asAdmin } = await makePlatformAdmin(t);
    await asAdmin.mutation(api.admin.invites.resend, { inviteId });

    const email = await queuedInviteEmail(t, inviteId);
    expect(email).toMatchObject({
      to: ["x@example.com"],
      subject: expect.stringContaining("Acme"),
    });
    // The credit line: the *original* inviter, not the admin who resent it.
    expect(email?.html).toContain("Test User");
  });

  it("refuses to resend an invite that is no longer pending", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const inviteId = await insertInvite(t, {
      workspaceId,
      invitedBy: ownerId,
      email: "x@example.com",
      status: InviteStatus.DECLINED,
    });

    const { asAdmin } = await makePlatformAdmin(t);
    await expect(
      asAdmin.mutation(api.admin.invites.resend, { inviteId }),
    ).rejects.toThrow(/Only pending invites/);
    expect(await queuedInviteEmail(t, inviteId)).toBeNull();
  });
});
