import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

async function setupClosedChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; adminId: Id<"users">; name?: string },
) {
  const { workspaceId, adminId, name = "closed-chan" } = opts;
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name,
      workspaceId,
      type: "closed" as const,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId,
      userId: adminId,
      role: ChannelRole.ADMIN,
    });
    return channelId;
  });
}

async function addWorkspaceMember(
  t: ReturnType<typeof createTestContext>,
  opts: { userId: Id<"users">; workspaceId: Id<"workspaces"> },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      role: "member",
    });
  });
}

describe("channelJoinRequests", () => {
  describe("requestJoin", () => {
    it("creates a pending request row", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "req@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .collect(),
      );
      expect(rows).toHaveLength(1);
    });

    it("is a no-op on second request (dedup)", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "req@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });
      await asRequester.mutation(api.channels.requestJoin, { channelId });

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .collect(),
      );
      expect(rows).toHaveLength(1);
    });

    it("throws when the user is already a channel member", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
        name: "Member",
        email: "m@example.com",
      });
      await addWorkspaceMember(t, { userId: memberId, workspaceId });
      await t.run(async (ctx) => {
        await ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: memberId,
          role: ChannelRole.MEMBER,
        });
      });

      await expect(
        asMember.mutation(api.channels.requestJoin, { channelId }),
      ).rejects.toThrow(/already a member/i);
    });

    it("rejects requests on open channels", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "open", workspaceId, type: "open" as const }),
      );

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await expect(
        asRequester.mutation(api.channels.requestJoin, { channelId }),
      ).rejects.toThrow(/open/i);
    });
  });

  describe("approveJoinRequest", () => {
    it("adds the user as a channel member and marks the row approved", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });

      const requestId = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .first();
        return row!._id;
      });

      await asAdmin.mutation(api.channels.approveJoinRequest, { requestId });

      const member = await t.run(async (ctx) =>
        ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId),
          )
          .first(),
      );
      expect(member).not.toBeNull();

      const row = await t.run(async (ctx) => ctx.db.get(requestId));
      expect(row?.status).toBe("approved");
      expect(row?.decidedBy).toBe(adminId);
    });

    it("rejects when caller is not a channel admin", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });
      const requestId = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .first();
        return row!._id;
      });

      await expect(
        asRequester.mutation(api.channels.approveJoinRequest, { requestId }),
      ).rejects.toThrow();
    });
  });

  describe("denyJoinRequest", () => {
    it("marks the row denied without adding a channel member", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });
      const requestId = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .first();
        return row!._id;
      });

      await asAdmin.mutation(api.channels.denyJoinRequest, { requestId });

      const row = await t.run(async (ctx) => ctx.db.get(requestId));
      expect(row?.status).toBe("denied");

      const member = await t.run(async (ctx) =>
        ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId),
          )
          .first(),
      );
      expect(member).toBeNull();
    });

    it("allows re-requesting after denial", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });
      const firstRequestId = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .first();
        return row!._id;
      });

      await asAdmin.mutation(api.channels.denyJoinRequest, { requestId: firstRequestId });
      await asRequester.mutation(api.channels.requestJoin, { channelId });

      const allRows = await t.run(async (ctx) =>
        ctx.db
          .query("channelJoinRequests")
          .withIndex("by_user_status", (q) => q.eq("userId", requesterId))
          .collect(),
      );
      const pending = allRows.filter((r) => r.status === "pending");
      const denied = allRows.filter((r) => r.status === "denied");
      expect(pending).toHaveLength(1);
      expect(denied).toHaveLength(1);
    });
  });

  describe("addToChannel auto-approve", () => {
    it("flips pending request to approved when admin adds member directly", async () => {
      const t = createTestContext();
      const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, adminId });

      const { userId: requesterId, asUser: asRequester } = await setupAuthenticatedUser(t, {
        name: "Requester",
        email: "r@example.com",
      });
      await addWorkspaceMember(t, { userId: requesterId, workspaceId });

      await asRequester.mutation(api.channels.requestJoin, { channelId });

      await asAdmin.mutation(api.channelMembers.addToChannel, {
        userId: requesterId,
        channelId,
      });

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "pending"),
          )
          .collect(),
      );
      expect(rows).toHaveLength(0);

      const approved = await t.run(async (ctx) =>
        ctx.db
          .query("channelJoinRequests")
          .withIndex("by_channel_user_status", (q) =>
            q.eq("channelId", channelId).eq("userId", requesterId).eq("status", "approved"),
          )
          .collect(),
      );
      expect(approved).toHaveLength(1);
    });
  });
});
