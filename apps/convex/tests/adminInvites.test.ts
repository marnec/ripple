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

/** One page big enough to hold every fixture in this file. */
const PAGE = { numItems: 50, cursor: null };

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
    const { page: invites } = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: PAGE,
    });

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
    const { page: invites } = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: PAGE,
    });

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
    const { page: invites } = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: PAGE,
    });

    const inAcme = invites.find((i) => i.workspaceId === workspaceId);
    const inOther = invites.find((i) => i.workspaceId === otherWorkspaceId);
    expect(inAcme).toMatchObject({ recipientUserId: memberId, recipientIsMember: true });
    expect(inOther).toMatchObject({ recipientUserId: memberId, recipientIsMember: false });
  });

  /**
   * The status tabs are an index range, not a client-side predicate over one
   * loaded page. That distinction is the whole point: an operator opens this
   * page to find a *stuck pending* invite, and filtering after pagination would
   * bury it behind whatever accepted invites happen to be newer.
   */
  it("filters by status on the server, so a pending invite older than a page of accepted ones is still reachable", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");

    await insertInvite(t, {
      workspaceId,
      invitedBy: ownerId,
      email: "stuck@example.com",
    });
    // Newer, and enough of them to fill the page asked for below.
    for (let i = 0; i < 5; i++) {
      await insertInvite(t, {
        workspaceId,
        invitedBy: ownerId,
        email: `accepted${i}@example.com`,
        status: InviteStatus.ACCEPTED,
      });
    }

    const { asAdmin } = await makePlatformAdmin(t);

    const pending = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: { numItems: 3, cursor: null },
      status: InviteStatus.PENDING,
    });
    expect(pending.page.map((i) => i.email)).toEqual(["stuck@example.com"]);

    // Without the filter the same page is all accepted — the case that made
    // client-side filtering wrong.
    const unfiltered = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(unfiltered.page.every((i) => i.status === InviteStatus.ACCEPTED)).toBe(true);
    expect(unfiltered.isDone).toBe(false);
  });

  it("pages through the full list with the returned cursor", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    for (let i = 0; i < 5; i++) {
      await insertInvite(t, { workspaceId, invitedBy: ownerId, email: `u${i}@example.com` });
    }

    const { asAdmin } = await makePlatformAdmin(t);
    const first = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);

    const second = await asAdmin.query(api.admin.invites.list, {
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(2);
    expect(second.isDone).toBe(true);

    const seen = [...first.page, ...second.page].map((i) => i.email);
    expect(new Set(seen).size).toBe(5);
  });

  it("rejects a signed-in user who isn't a platform admin", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);

    await expect(
      asUser.query(api.admin.invites.list, { paginationOpts: PAGE }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("admin.invites.siteUrl", () => {
  /**
   * Split out of `list` because a paginated query must return the
   * `PaginationResult` shape and nothing else — it can no longer carry a
   * sidecar field. Still guarded: it reports deployment configuration.
   */
  it("is guarded like the list it was split out of", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);

    await expect(asUser.query(api.admin.invites.siteUrl, {})).rejects.toThrow(
      /Not authorized/,
    );

    const { asAdmin } = await makePlatformAdmin(t);
    await expect(asAdmin.query(api.admin.invites.siteUrl, {})).resolves.not.toThrow();
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
