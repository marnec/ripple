import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/** Add a second user to the workspace with the given role; returns their bound ctx. */
async function addMember(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Parameters<typeof api.workspaceInvites.listByWorkspace>[0]["workspaceId"],
  role: (typeof WorkspaceRole)[keyof typeof WorkspaceRole],
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Member",
    email: "member@example.com",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", { userId, workspaceId, role });
  });
  return { userId, asUser };
}

describe("workspaceInvites.listByWorkspace", () => {
  it("returns only pending invites with the inviter's name", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "pending@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      });
      await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "accepted@example.com",
        invitedBy: userId,
        status: InviteStatus.ACCEPTED,
      });
    });

    const result = await asUser.query(api.workspaceInvites.listByWorkspace, {
      workspaceId,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      email: "pending@example.com",
      inviterName: "Test User",
    });
  });

  /**
   * A pending invite whose mail bounced looks exactly like one the recipient
   * has not got round to answering — which is the whole defect T6 names. The
   * list is where an admin would notice, so it has to carry the delivery state.
   */
  it("exposes the delivery state of an invite whose email bounced", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "typo@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
        deliveryEmailId: "email-1",
        deliveryStatus: "bounced",
        deliveryError: "The recipient's mailbox does not exist.",
      });
    });

    const [invite] = await asUser.query(api.workspaceInvites.listByWorkspace, {
      workspaceId,
    });

    expect(invite).toMatchObject({
      email: "typo@example.com",
      deliveryStatus: "bounced",
      deliveryError: "The recipient's mailbox does not exist.",
    });
  });

  it("leaves delivery fields absent for an invite that has not been mailed", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "legacy@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      });
    });

    const [invite] = await asUser.query(api.workspaceInvites.listByWorkspace, {
      workspaceId,
    });

    expect(invite.deliveryStatus).toBeUndefined();
    expect(invite.deliveryError).toBeUndefined();
  });

  it("rejects a non-admin member", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser } = await addMember(t, workspaceId, WorkspaceRole.MEMBER);

    await expect(
      asUser.query(api.workspaceInvites.listByWorkspace, { workspaceId }),
    ).rejects.toThrow();
  });
});

describe("workspaceInvites.revoke", () => {
  it("deletes a pending invite, breaking its link", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "revoke@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      }),
    );

    await asUser.mutation(api.workspaceInvites.revoke, { inviteId });

    // The row is gone, so the public lookup that backs the invite link 404s.
    const stillThere = await t.run(async (ctx) => ctx.db.get(inviteId));
    expect(stillThere).toBeNull();
    expect(
      await t.query(api.workspaceInvites.getPublic, { inviteId }),
    ).toBeNull();
  });

  it("refuses to revoke a non-pending invite", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "accepted@example.com",
        invitedBy: userId,
        status: InviteStatus.ACCEPTED,
      }),
    );

    await expect(
      asUser.mutation(api.workspaceInvites.revoke, { inviteId }),
    ).rejects.toThrow();
  });

  it("rejects a non-admin member", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser } = await addMember(t, workspaceId, WorkspaceRole.MEMBER);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "revoke@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      }),
    );

    await expect(
      asUser.mutation(api.workspaceInvites.revoke, { inviteId }),
    ).rejects.toThrow();

    // Invite must survive the rejected revoke.
    expect(await t.run(async (ctx) => ctx.db.get(inviteId))).not.toBeNull();
  });
});

describe("workspaceInvites.resend", () => {
  it("resends a pending invite without mutating its status", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "resend@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      }),
    );

    await asUser.mutation(api.workspaceInvites.resend, { inviteId });

    const invite = await t.run(async (ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe(InviteStatus.PENDING);
  });

  it("refuses to resend a non-pending invite", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "declined@example.com",
        invitedBy: userId,
        status: InviteStatus.DECLINED,
      }),
    );

    await expect(
      asUser.mutation(api.workspaceInvites.resend, { inviteId }),
    ).rejects.toThrow();
  });
});
