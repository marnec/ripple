import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * Message access follows the *channel* rule (`requireChannelAccess`), not the
 * workspace rule: open channels are readable by any workspace member, while
 * closed channels and DMs require a `channelMembers` row. Gating on workspace
 * membership alone would let any colleague read and post in a private channel
 * or someone else's DM by calling the API with a channel id.
 */

/** A second workspace member who is deliberately not in any channel. */
async function setupWorkspaceOutsider(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Nosy Colleague",
    email: "nosy@example.com",
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return { userId, asUser };
}

async function setupClosedChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "leadership",
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

async function setupOpenChannel(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  return t.run((ctx) =>
    ctx.db.insert("channels", {
      name: "general",
      workspaceId,
      type: "open" as const,
    }),
  );
}

async function insertMessage(
  t: ReturnType<typeof createTestContext>,
  opts: { channelId: Id<"channels">; userId: Id<"users">; text?: string },
) {
  const text = opts.text ?? "salary review notes";
  return t.run((ctx) =>
    ctx.db.insert("messages", {
      channelId: opts.channelId,
      userId: opts.userId,
      isomorphicId: `msg-${opts.channelId}-${text}`,
      body: text,
      plainText: text,
      deleted: false,
    }),
  );
}

const FIRST_PAGE = { numItems: 10, cursor: null };

describe("messages access", () => {
  describe("closed channels", () => {
    it("denies list to a workspace member who is not a channel member", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });
      await insertMessage(t, { channelId, userId });

      const { asUser: asOutsider } = await setupWorkspaceOutsider(t, workspaceId);

      await expect(
        asOutsider.query(api.messages.list, {
          channelId,
          paginationOpts: FIRST_PAGE,
        }),
      ).rejects.toThrow("Not a member of this channel");
    });

    it("denies send to a workspace member who is not a channel member", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });

      const { asUser: asOutsider } = await setupWorkspaceOutsider(t, workspaceId);

      await expect(
        asOutsider.mutation(api.messages.send, {
          channelId,
          isomorphicId: "intruder-1",
          body: "let me in",
          plainText: "let me in",
        }),
      ).rejects.toThrow("Not a member of this channel");

      const stored = await t.run((ctx) => ctx.db.query("messages").collect());
      expect(stored).toHaveLength(0);
    });

    it("denies search to a workspace member who is not a channel member", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });
      await insertMessage(t, { channelId, userId });

      const { asUser: asOutsider } = await setupWorkspaceOutsider(t, workspaceId);

      await expect(
        asOutsider.query(api.messages.search, { channelId, searchTerm: "salary" }),
      ).rejects.toThrow("Not a member of this channel");
    });

    it("denies getMessageContext to a workspace member who is not a channel member", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });
      const messageId = await insertMessage(t, { channelId, userId });

      const { asUser: asOutsider } = await setupWorkspaceOutsider(t, workspaceId);

      await expect(
        asOutsider.query(api.messages.getMessageContext, { messageId }),
      ).rejects.toThrow("Not a member of this channel");
    });

    it("still allows an actual channel member to list", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupClosedChannel(t, { workspaceId, userId });
      await insertMessage(t, { channelId, userId });

      const result = await asUser.query(api.messages.list, {
        channelId,
        paginationOpts: FIRST_PAGE,
      });

      expect(result.page).toHaveLength(1);
    });
  });

  describe("direct messages", () => {
    it("denies list to a third workspace member outside the conversation", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const { userId: partnerId } = await setupAuthenticatedUser(t, {
        name: "Partner",
        email: "partner@example.com",
      });
      await t.run((ctx) =>
        ctx.db.insert("workspaceMembers", {
          userId: partnerId,
          workspaceId,
          role: WorkspaceRole.MEMBER,
        }),
      );
      const channelId = await setupDmChannel(t, {
        workspaceId,
        userIds: [userId, partnerId],
      });
      await insertMessage(t, { channelId, userId, text: "just between us" });

      const { asUser: asThirdParty } = await setupWorkspaceOutsider(t, workspaceId);

      await expect(
        asThirdParty.query(api.messages.list, {
          channelId,
          paginationOpts: FIRST_PAGE,
        }),
      ).rejects.toThrow("Not a member of this channel");
    });

    it("still allows a participant to list their own DM", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: partnerId } = await setupAuthenticatedUser(t, {
        name: "Partner",
        email: "partner@example.com",
      });
      await t.run((ctx) =>
        ctx.db.insert("workspaceMembers", {
          userId: partnerId,
          workspaceId,
          role: WorkspaceRole.MEMBER,
        }),
      );
      const channelId = await setupDmChannel(t, {
        workspaceId,
        userIds: [userId, partnerId],
      });
      await insertMessage(t, { channelId, userId, text: "just between us" });

      const result = await asUser.query(api.messages.list, {
        channelId,
        paginationOpts: FIRST_PAGE,
      });

      expect(result.page).toHaveLength(1);
    });
  });

  describe("open channels", () => {
    it("remains readable by any workspace member without a channelMembers row", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, workspaceId);
      await insertMessage(t, { channelId, userId, text: "hello team" });

      const { asUser: asColleague } = await setupWorkspaceOutsider(t, workspaceId);

      const result = await asColleague.query(api.messages.list, {
        channelId,
        paginationOpts: FIRST_PAGE,
      });

      expect(result.page).toHaveLength(1);
    });

    it("stays closed to users outside the workspace", async () => {
      const t = createTestContext();
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupOpenChannel(t, workspaceId);
      const { asUser: asStranger } = await setupAuthenticatedUser(t, {
        name: "Stranger",
        email: "stranger@example.com",
      });

      await expect(
        asStranger.query(api.messages.list, {
          channelId,
          paginationOpts: FIRST_PAGE,
        }),
      ).rejects.toThrow("Not a member of this workspace");
    });
  });
});
