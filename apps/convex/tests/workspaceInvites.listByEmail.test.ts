import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * `listByEmail` is the invitee's side of an invite — the only source for the
 * pending-invite banner (UserMenu, NotificationDrawer, the PendingInvites
 * page). `create` stamps the Resend delivery columns onto the row in the same
 * transaction that inserts it, so every invite carries them and the query has
 * to account for them.
 *
 * The existing emailDelivery tests only ever read those columns back through
 * `t.run`, never through this query, which is why the omission shipped green.
 */
async function inviteSomeone(t: ReturnType<typeof createTestContext>) {
  const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

  const invitedEmail = "invitee@example.com";
  const { asUser: asInvitee } = await setupAuthenticatedUser(t, {
    name: "Invitee",
    email: invitedEmail,
  });

  const inviteId = await asAdmin.mutation(api.workspaceInvites.create, {
    workspaceId,
    email: invitedEmail,
  });

  return { workspaceId, inviteId, invitedEmail, asAdmin, asInvitee };
}

describe("workspaceInvites.listByEmail", () => {
  it("returns the pending invite to the user it was addressed to", async () => {
    const t = createTestContext();
    const { inviteId, invitedEmail, workspaceId, asInvitee } = await inviteSomeone(t);

    const invites = await asInvitee.query(api.workspaceInvites.listByEmail, {});

    expect(invites).toHaveLength(1);
    expect(invites[0]._id).toBe(inviteId);
    expect(invites[0].email).toBe(invitedEmail);
    expect(invites[0].workspace?._id).toBe(workspaceId);
    expect(invites[0].inviterName).toBe("Test User");
  });

  it("does not hand the invitee the Resend delivery columns", async () => {
    const t = createTestContext();
    const { inviteId, asInvitee } = await inviteSomeone(t);

    // Precondition: there is something to leak. `create` → `sendWorkspaceInviteEmail`
    // stamps these in the same transaction, so the row carries them.
    const row = await t.run((ctx) => ctx.db.get(inviteId));
    expect(typeof row!.deliveryEmailId).toBe("string");
    expect(row!.deliveryStatus).toBeDefined();

    const invites = await asInvitee.query(api.workspaceInvites.listByEmail, {});

    // The recipient sees the invite, not how the mail about it went. Delivery
    // state is the admin's view (`listByWorkspace`).
    expect(invites[0]).not.toHaveProperty("deliveryEmailId");
    expect(invites[0]).not.toHaveProperty("deliveryStatus");
    expect(invites[0]).not.toHaveProperty("deliveryError");
  });
});
