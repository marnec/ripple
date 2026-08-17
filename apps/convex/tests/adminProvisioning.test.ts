import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { EmailId } from "@convex-dev/resend";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { readEmail } from "../convex/emailDelivery";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The console's provisioning half: create a workspace, then invite people into
 * it. Both are platform-admin twins of product mutations that authorize on
 * *workspace* membership, so the property each test group is really pinning is
 * that the operator can act on a workspace they are not a member of — and that
 * nobody else can.
 */

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "ops@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

async function membership(t: T, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  return t.run((ctx) =>
    ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first(),
  );
}

async function queuedInviteEmail(t: T, inviteId: Id<"workspaceInvites">) {
  return await t.run(async (ctx) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite?.deliveryEmailId) return null;
    return await readEmail(ctx, invite.deliveryEmailId as EmailId);
  });
}

describe("admin.workspaces.create", () => {
  it("defaults ownership to the operator and makes them its admin", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);

    const workspaceId = await asAdmin.mutation(api.admin.workspaces.create, {
      name: "  Acme  ",
      description: "  The customer  ",
    });

    const ws = await t.run((ctx) => ctx.db.get(workspaceId));
    expect(ws).toMatchObject({ name: "Acme", description: "The customer", ownerId: adminId });
    expect(await membership(t, workspaceId, adminId)).toMatchObject({
      role: WorkspaceRole.ADMIN,
    });
  });

  it("hands ownership to an existing account by email, leaving the operator out of it", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);
    const ownerId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Mia", email: "mia@example.com" }),
    );

    // Mixed case + padding: the address goes through the same normalization the
    // invite path uses, or the lookup misses an account that exists.
    const workspaceId = await asAdmin.mutation(api.admin.workspaces.create, {
      name: "Acme",
      ownerEmail: " Mia@Example.com ",
    });

    expect(await t.run((ctx) => ctx.db.get(workspaceId))).toMatchObject({ ownerId });
    expect(await membership(t, workspaceId, ownerId)).toMatchObject({
      role: WorkspaceRole.ADMIN,
    });
    // The operator provisioned it; that does not make them a tenant.
    expect(await membership(t, workspaceId, adminId)).toBeNull();
  });

  it("treats a blank owner email as 'own it yourself'", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);

    const workspaceId = await asAdmin.mutation(api.admin.workspaces.create, {
      name: "Acme",
      ownerEmail: "   ",
    });

    expect(await t.run((ctx) => ctx.db.get(workspaceId))).toMatchObject({ ownerId: adminId });
  });

  /**
   * `workspaces.ownerId` is a real FK and there is no way to mint a user
   * outside an auth flow, so this has to fail rather than invent an account.
   */
  it("refuses an owner email with no account behind it", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(
      asAdmin.mutation(api.admin.workspaces.create, {
        name: "Acme",
        ownerEmail: "nobody@example.com",
      }),
    ).rejects.toThrow(/No account for nobody@example.com/);

    expect(await t.run((ctx) => ctx.db.query("workspaces").collect())).toHaveLength(0);
  });

  it("refuses a malformed owner email", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(
      asAdmin.mutation(api.admin.workspaces.create, { name: "Acme", ownerEmail: "not-an-email" }),
    ).rejects.toThrow(/Invalid email address/);
  });

  it("refuses a whitespace-only name", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(
      asAdmin.mutation(api.admin.workspaces.create, { name: "   " }),
    ).rejects.toThrow(/name is required/);
  });

  it("rejects a signed-in user who isn't a platform admin", async () => {
    const t = createTestContext();
    const { asUser } = await setupAuthenticatedUser(t);

    await expect(
      asUser.mutation(api.admin.workspaces.create, { name: "Acme" }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("admin.invites.create", () => {
  it("invites into a workspace the operator isn't a member of, crediting them as the inviter", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");
    const { adminId, asAdmin } = await makePlatformAdmin(t);

    const inviteId = await asAdmin.mutation(api.admin.invites.create, {
      workspaceId,
      email: " New.Person@Example.com ",
    });

    expect(await t.run((ctx) => ctx.db.get(inviteId))).toMatchObject({
      workspaceId,
      // Normalized on the way in — this is the value `accept` compares against
      // the signed-in user's address.
      email: "new.person@example.com",
      invitedBy: adminId,
      status: InviteStatus.PENDING,
    });

    const email = await queuedInviteEmail(t, inviteId);
    expect(email).toMatchObject({
      to: ["new.person@example.com"],
      subject: expect.stringContaining("Acme"),
    });
    // Unlike `resend`, this really is a new invite from the operator.
    expect(email?.html).toContain("Platform Admin");
  });

  it("refuses a second pending invite for the same address", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    await asAdmin.mutation(api.admin.invites.create, {
      workspaceId,
      email: "x@example.com",
    });
    await expect(
      asAdmin.mutation(api.admin.invites.create, { workspaceId, email: "X@example.com" }),
    ).rejects.toThrow(/already sent/);
  });

  it("refuses an address that is already a member", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Mia", email: "mia@example.com" });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await expect(
      asAdmin.mutation(api.admin.invites.create, { workspaceId, email: "mia@example.com" }),
    ).rejects.toThrow(/already a member/);
  });

  it("refuses a malformed address before anything is queued", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(
      asAdmin.mutation(api.admin.invites.create, { workspaceId, email: "not-an-email" }),
    ).rejects.toThrow(/Invalid email address/);
    expect(await t.run((ctx) => ctx.db.query("workspaceInvites").collect())).toHaveLength(0);
  });

  it("rejects a signed-in user who isn't a platform admin", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    // Even though this caller *is* a workspace admin — the console's mutation
    // is not a second door into the product's own invite flow.
    await expect(
      asUser.mutation(api.admin.invites.create, { workspaceId, email: "x@example.com" }),
    ).rejects.toThrow(/Not authorized/);
  });
});
