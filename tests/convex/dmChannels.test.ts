import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@shared/enums/roles";

describe("channels.createDm", () => {
  it("creates a DM between two workspace members", async () => {
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

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    expect(channelId).toBeDefined();

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.type).toBe("dm");
    expect(channel?.name).toBe("");
  });

  it("deduplicates DMs — second call returns the same channel", async () => {
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

    const firstId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    const secondId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    expect(firstId).toBe(secondId);
  });

  it("cannot create a DM with yourself", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

    await expect(
      asAdmin.mutation(api.channels.createDm, {
        workspaceId,
        otherUserId: adminId,
      }),
    ).rejects.toThrow("Cannot create a DM with yourself");
  });

  it("cannot rename a DM", async () => {
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

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    await expect(
      asAdmin.mutation(api.channels.update, {
        id: channelId,
        name: "new name",
      }),
    ).rejects.toThrow("Cannot rename a DM");
  });

  it("cannot add members to a DM", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: member1Id } = await setupAuthenticatedUser(t, { name: "Member1", email: "m1@test.com" });
    const { userId: member2Id } = await setupAuthenticatedUser(t, { name: "Member2", email: "m2@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: member1Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: member2Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: member1Id,
    });

    await expect(
      asAdmin.mutation(api.channelMembers.addToChannel, {
        channelId,
        userId: member2Id,
      }),
    ).rejects.toThrow("Cannot add members to a DM");
  });

  it("getAccessInfo returns DM participant info for non-members (dm existence is public)", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: member1Id } = await setupAuthenticatedUser(t, { name: "Member1", email: "m1@test.com" });
    const { userId: outsiderId, asUser: asOutsider } = await setupAuthenticatedUser(t, { name: "Outsider", email: "out@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: member1Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: outsiderId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    // Admin and member1 have a DM; outsider is not in it
    const dmId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: member1Id,
    });

    // Outsider should get { isMember: false, type: "dm", participants: [...] }
    const outsiderAccess = await asOutsider.query(api.channels.getAccessInfo, {
      channelId: dmId,
    });
    expect(outsiderAccess).not.toBeNull();
    expect(outsiderAccess).toMatchObject({ isMember: false, type: "dm" });
    if (outsiderAccess && !outsiderAccess.isMember && outsiderAccess.type === "dm") {
      const names = outsiderAccess.participants.map((p) => p.name).sort();
      expect(names).toEqual(["Member1", "Test User"]);
    }

    // Admin (a member of the DM) should get { isMember: true }
    const adminAccess = await asAdmin.query(api.channels.getAccessInfo, {
      channelId: dmId,
    });
    expect(adminAccess).toEqual({ isMember: true });
  });
});
