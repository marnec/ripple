import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

describe("workspaceInvites.getPublic", () => {
  it("returns the bound email, workspace and inviter without auth", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "invited@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      }),
    );

    // No withIdentity — this query must be reachable unauthenticated.
    const result = await t.query(api.workspaceInvites.getPublic, { inviteId });

    expect(result).toEqual({
      email: "invited@example.com",
      workspaceName: "Acme",
      inviterName: "Test User",
      status: InviteStatus.PENDING,
    });
  });

  it("returns null for a malformed token", async () => {
    const t = createTestContext();

    const result = await t.query(api.workspaceInvites.getPublic, {
      inviteId: "not-a-real-id",
    });

    expect(result).toBeNull();
  });

  it("returns null for a well-formed id that does not exist", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);

    // Create then delete to obtain a valid-shaped but dangling id.
    const inviteId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "gone@example.com",
        invitedBy: userId,
        status: InviteStatus.PENDING,
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await t.query(api.workspaceInvites.getPublic, { inviteId });

    expect(result).toBeNull();
  });

  it("reflects a non-pending status", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);

    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceInvites", {
        workspaceId,
        email: "accepted@example.com",
        invitedBy: userId,
        status: InviteStatus.ACCEPTED,
      }),
    );

    const result = await t.query(api.workspaceInvites.getPublic, { inviteId });

    expect(result?.status).toBe(InviteStatus.ACCEPTED);
  });
});
