import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

async function setupOpenChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; name?: string },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("channels", {
      name: opts.name ?? "open-channel",
      workspaceId: opts.workspaceId,
      type: "open" as const,
    }),
  );
}

async function setupClosedChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; name?: string },
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: opts.name ?? "closed-channel",
      workspaceId: opts.workspaceId,
      type: "closed" as const,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      role: ChannelRole.ADMIN,
    });
    return channelId;
  });
}

async function setupDmChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userIds: Id<"users">[] },
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "",
      workspaceId: opts.workspaceId,
      type: "dm" as const,
    });
    for (const userId of opts.userIds) {
      await ctx.db.insert("channelMembers", {
        channelId,
        workspaceId: opts.workspaceId,
        userId,
        role: ChannelRole.MEMBER,
      });
    }
    return channelId;
  });
}

async function insertMessage(
  t: ReturnType<typeof createTestContext>,
  opts: { channelId: Id<"channels">; userId: Id<"users"> },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("messages", {
      channelId: opts.channelId,
      userId: opts.userId,
      isomorphicId: `msg-${Date.now()}-${Math.random()}`,
      body: "hi",
      plainText: "hi",
      deleted: false,
    }),
  );
}

describe("channelVisibility", () => {
  describe("hideChannel", () => {
    it("sets hiddenAt on userChannelState for an open channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });

      await asUser.mutation(api.channelVisibility.hideChannel, { channelId });

      const state = await t.run(async (ctx) =>
        ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .unique(),
      );
      expect(state?.hiddenAt).toBeDefined();
      expect(state!.hiddenAt!).toBeGreaterThan(0);
      expect(state!.workspaceId).toBe(workspaceId);
    });

    it("sets hiddenAt on userChannelState for a DM", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: otherId } = await setupAuthenticatedUser(t, {
        name: "Other", email: "o@x.io",
      });
      await t.run(async (ctx) =>
        ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" }),
      );
      const channelId = await setupDmChannel(t, { workspaceId, userIds: [userId, otherId] });

      await asUser.mutation(api.channelVisibility.hideChannel, { channelId });

      const state = await t.run(async (ctx) =>
        ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .unique(),
      );
      expect(state?.hiddenAt).toBeGreaterThan(0);
    });

    it("rejects closed channels with a guiding message", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });

      await expect(
        asUser.mutation(api.channelVisibility.hideChannel, { channelId }),
      ).rejects.toThrow("leave the channel instead");
    });

    it("patches existing userChannelState row instead of duplicating", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });

      // Pre-seed with lastReadAt so we can confirm it survives.
      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, lastReadAt: 12345,
        }),
      );

      await asUser.mutation(api.channelVisibility.hideChannel, { channelId });

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .collect(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].hiddenAt).toBeGreaterThan(0);
      expect(rows[0].lastReadAt).toBe(12345);
    });

    it("rejects non-workspace-members", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });
      const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
        name: "Outsider", email: "out@x.io",
      });

      await expect(
        asOutsider.mutation(api.channelVisibility.hideChannel, { channelId }),
      ).rejects.toThrow();
    });
  });

  describe("unhideChannel", () => {
    it("clears hiddenAt while preserving lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });

      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, lastReadAt: 99, hiddenAt: Date.now(),
        }),
      );

      await asUser.mutation(api.channelVisibility.unhideChannel, { channelId });

      const state = await t.run(async (ctx) =>
        ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .unique(),
      );
      expect(state?.hiddenAt).toBeUndefined();
      expect(state?.lastReadAt).toBe(99);
    });

    it("is a no-op when no userChannelState row exists", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });

      await expect(
        asUser.mutation(api.channelVisibility.unhideChannel, { channelId }),
      ).resolves.toBeNull();
    });

    it("is a no-op when hiddenAt is already absent", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, { workspaceId });

      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, lastReadAt: 1,
        }),
      );

      await asUser.mutation(api.channelVisibility.unhideChannel, { channelId });

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .collect(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].lastReadAt).toBe(1);
    });
  });

  describe("workspaceSidebarData.get filtering", () => {
    it("filters out hidden open channels by default", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const visibleId = await setupOpenChannel(t, { workspaceId, name: "visible" });
      const hiddenId = await setupOpenChannel(t, { workspaceId, name: "hidden" });

      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId: hiddenId, workspaceId, hiddenAt: Date.now(),
        }),
      );

      const result = await asUser.query(api.workspaceSidebarData.get, { workspaceId });
      const ids = result.channels.map((c) => c._id);
      expect(ids).toContain(visibleId);
      expect(ids).not.toContain(hiddenId);
      expect(result.hiddenChannelCount).toBe(1);
    });

    it("includes hidden channels when includeHidden=true with isHidden flag set", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const visibleId = await setupOpenChannel(t, { workspaceId, name: "visible" });
      const hiddenId = await setupOpenChannel(t, { workspaceId, name: "hidden" });

      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId: hiddenId, workspaceId, hiddenAt: Date.now(),
        }),
      );

      const result = await asUser.query(api.workspaceSidebarData.get, {
        workspaceId, includeHidden: true,
      });
      const byId = new Map(result.channels.map((c) => [c._id, c]));
      expect(byId.get(visibleId)?.isHidden).toBe(false);
      expect(byId.get(hiddenId)?.isHidden).toBe(true);
      expect(result.hiddenChannelCount).toBe(1);
    });

    it("auto-unhides a DM whose latest message is newer than hiddenAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: otherId } = await setupAuthenticatedUser(t, {
        name: "Other", email: "o@x.io",
      });
      await t.run(async (ctx) =>
        ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" }),
      );
      const channelId = await setupDmChannel(t, { workspaceId, userIds: [userId, otherId] });

      // Hide first, then a message arrives after.
      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, hiddenAt: Date.now() - 10000,
        }),
      );
      await insertMessage(t, { channelId, userId: otherId });

      const result = await asUser.query(api.workspaceSidebarData.get, { workspaceId });
      const ids = result.channels.map((c) => c._id);
      expect(ids).toContain(channelId);
      expect(result.hiddenChannelCount).toBe(0);
    });

    it("keeps a DM hidden when no message is newer than hiddenAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: otherId } = await setupAuthenticatedUser(t, {
        name: "Other", email: "o@x.io",
      });
      await t.run(async (ctx) =>
        ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" }),
      );
      const channelId = await setupDmChannel(t, { workspaceId, userIds: [userId, otherId] });

      // Message arrives FIRST, then we hide. No newer message → stays hidden.
      await insertMessage(t, { channelId, userId: otherId });
      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, hiddenAt: Date.now() + 10000,
        }),
      );

      const result = await asUser.query(api.workspaceSidebarData.get, { workspaceId });
      expect(result.channels.map((c) => c._id)).not.toContain(channelId);
      expect(result.hiddenChannelCount).toBe(1);
    });

    it("never hides closed channels even if hiddenAt is set", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });

      // Anomalous state (closed channels should never reach this), but the
      // query must be defensive.
      await t.run(async (ctx) =>
        ctx.db.insert("userChannelState", {
          userId, channelId, workspaceId, hiddenAt: Date.now(),
        }),
      );

      const result = await asUser.query(api.workspaceSidebarData.get, { workspaceId });
      const closed = result.channels.find((c) => c._id === channelId);
      expect(closed).toBeDefined();
      expect(closed!.isHidden).toBe(false);
      expect(result.hiddenChannelCount).toBe(0);
    });
  });
});

describe("amILastAdmin", () => {
  it("returns true when caller is the sole admin of a closed channel", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });

    await expect(
      asUser.query(api.channelMembers.amILastAdmin, { channelId }),
    ).resolves.toBe(true);
  });

  it("returns false when another admin exists", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });

    const { userId: otherId } = await setupAuthenticatedUser(t, {
      name: "Co-admin", email: "co@x.io",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" });
      await ctx.db.insert("channelMembers", {
        channelId, workspaceId, userId: otherId, role: ChannelRole.ADMIN,
      });
    });

    await expect(
      asUser.query(api.channelMembers.amILastAdmin, { channelId }),
    ).resolves.toBe(false);
  });

  it("returns false when caller is not an admin", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });

    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
      name: "Member", email: "m@x.io",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", { userId: memberId, workspaceId, role: "member" });
      await ctx.db.insert("channelMembers", {
        channelId, workspaceId, userId: memberId, role: ChannelRole.MEMBER,
      });
    });

    await expect(
      asMember.query(api.channelMembers.amILastAdmin, { channelId }),
    ).resolves.toBe(false);
  });

  it("returns false for open channels regardless of admin state", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupOpenChannel(t, { workspaceId });

    // Even if there happens to be an admin row, opens are not "led" by an admin
    // in this app's model — the concept doesn't apply.
    await t.run(async (ctx) =>
      ctx.db.insert("channelMembers", {
        channelId, workspaceId, userId, role: ChannelRole.ADMIN,
      }),
    );

    await expect(
      asUser.query(api.channelMembers.amILastAdmin, { channelId }),
    ).resolves.toBe(false);
  });

  it("returns false for DMs", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: otherId } = await setupAuthenticatedUser(t, {
      name: "Other", email: "o@x.io",
    });
    await t.run(async (ctx) =>
      ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" }),
    );
    const channelId = await setupDmChannel(t, { workspaceId, userIds: [userId, otherId] });

    await expect(
      asUser.query(api.channelMembers.amILastAdmin, { channelId }),
    ).resolves.toBe(false);
  });
});
