import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole, ChannelRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

  it("preserves DM channels and memberships on member removal so history is kept and re-add reunites", async () => {
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

    const dmId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: memberId,
    });

    // DM channel and both channelMember rows should still exist
    const dm = await t.run(async (ctx) => ctx.db.get(dmId));
    expect(dm).not.toBeNull();

    const members = await t.run(async (ctx) =>
      ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", dmId))
        .collect(),
    );
    expect(members).toHaveLength(2);

    // Re-add the member
    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    // createDm dedup should return the same DM — history preserved
    const secondId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });
    expect(secondId).toBe(dmId);
  });

  it("cascade-deletes an abandoned DM when both members are removed from the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: member1Id, asUser: asMember1 } = await setupAuthenticatedUser(t, {
      name: "Member1",
      email: "m1@test.com",
    });
    const { userId: member2Id } = await setupAuthenticatedUser(t, {
      name: "Member2",
      email: "m2@test.com",
    });

    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: member1Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await db.insert("workspaceMembers", {
        userId: member2Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const dmId = await asMember1.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: member2Id,
    });

    // Remove member1 first — DM should be preserved (member2 still active)
    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: member1Id,
    });

    const afterFirst = await t.run(async (ctx) => ctx.db.get(dmId));
    expect(afterFirst).not.toBeNull();

    // Remove member2 — DM is now abandoned and should be cascade-deleted
    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: member2Id,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const afterSecond = await t.run(async (ctx) => ctx.db.get(dmId));
    expect(afterSecond).toBeNull();
  });

  it("createDm dedup falls back to email when the other user's row was replaced", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: originalId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });

    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: originalId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const dmId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: originalId,
    });

    // Simulate account deletion + re-signup: remove from workspace, delete the
    // user row, create a fresh user row with the same email, re-add to workspace.
    await asAdmin.mutation(api.workspaceMembers.remove, {
      workspaceId,
      targetUserId: originalId,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(originalId);
    });

    const { userId: newId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });
    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: newId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    // Dedup should find the existing DM via email match and patch the stale row
    const matchedId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: newId,
    });
    expect(matchedId).toBe(dmId);

    // The stale channelMember row should now point to the new user ID
    const members = await t.run(async (ctx) =>
      ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", dmId))
        .collect(),
    );
    const userIds = members.map((m) => m.userId).sort();
    expect(userIds).toContain(newId);
    expect(userIds).not.toContain(originalId);
  });
});
