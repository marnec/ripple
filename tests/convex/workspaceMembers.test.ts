import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole, ChannelRole } from "@shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../../convex/dbTriggers";

describe("workspaceMembers.changeRole", () => {
  it("admin can promote a member to admin", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await asAdmin.mutation(api.workspaceMembers.changeRole, {
      workspaceId,
      targetUserId: memberId,
      role: "admin",
    });

    const membership = await t.run(async (ctx) => {
      return ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", memberId),
        )
        .unique();
    });

    expect(membership?.role).toBe("admin");
  });

  it("cannot demote the last admin", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

    await expect(
      asAdmin.mutation(api.workspaceMembers.changeRole, {
        workspaceId,
        targetUserId: adminId,
        role: "member",
      }),
    ).rejects.toThrow("Cannot demote the last workspace admin");
  });

  it("non-admin cannot change roles", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await expect(
      asMember.mutation(api.workspaceMembers.changeRole, {
        workspaceId,
        targetUserId: memberId,
        role: "admin",
      }),
    ).rejects.toThrow("Insufficient permissions");
  });
});

describe("workspaceMembers.remove", () => {
  it("admin can remove a member", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: memberId,
    });

    const membership = await t.run(async (ctx) => {
      return ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", memberId),
        )
        .unique();
    });

    expect(membership).toBeNull();
  });

  it("cannot remove yourself", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

    await expect(
      asAdmin.mutation(api.workspaceMembers.remove, {
        workspaceId,
        targetUserId: adminId,
      }),
    ).rejects.toThrow("Cannot remove yourself");
  });

  it("transfers closed channel admin on removal", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    // Create member and a closed channel where member is sole admin
    const channelId = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });

      const chId = await db.insert("channels", {
        name: "secret",
        workspaceId,
        type: "closed" as const,
      });

      // Admin is regular channel member (inserted first = longest tenured)
      await db.insert("channelMembers", {
        channelId: chId,
        userId: adminId,
        role: ChannelRole.MEMBER,
        workspaceId,
      });

      // Member is channel admin
      await db.insert("channelMembers", {
        channelId: chId,
        userId: memberId,
        role: ChannelRole.ADMIN,
        workspaceId,
      });

      return chId;
    });

    // Remove the member (who is the sole channel admin)
    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: memberId,
    });

    // The workspace admin should now be promoted to channel admin
    const adminChannelMembership = await t.run(async (ctx) => {
      return ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", adminId),
        )
        .unique();
    });

    expect(adminChannelMembership?.role).toBe("admin");

    // The removed member should no longer be a channel member
    const removedMembership = await t.run(async (ctx) => {
      return ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", memberId),
        )
        .unique();
    });

    expect(removedMembership).toBeNull();
  });
});
