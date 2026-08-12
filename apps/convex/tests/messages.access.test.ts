import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  deliveredPushes,
  resetDeliveredPushes,
  type DeliveredPush,
} from "./pushProbe";

// Push delivery goes through `notificationPool`, so the observable is what
// reached the web-push helpers after the pool drains — see `pushProbe.ts`.
vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

beforeEach(() => {
  resetDeliveredPushes();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

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

/** A workspace member who is also a member of the given channel. */
async function setupChannelMember(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    channelId: Id<"channels">;
    name: string;
    email: string;
  },
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: opts.name,
    email: opts.email,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: opts.workspaceId,
      role: WorkspaceRole.MEMBER,
    });
    await ctx.db.insert("channelMembers", {
      channelId: opts.channelId,
      workspaceId: opts.workspaceId,
      userId,
      role: ChannelRole.MEMBER,
    });
  });
  return { userId, asUser };
}

/** A BlockNote body carrying `@` mentions of the given user ids. */
function bodyMentioning(userIds: Id<"users">[], text = "look at this"): string {
  return JSON.stringify([
    {
      type: "paragraph",
      content: [
        ...userIds.map((userId) => ({ type: "userMention", props: { userId } })),
        { type: "text", text: ` ${text}`, styles: {} },
      ],
    },
  ]);
}

/** The pushes delivered so far, newest last. */
async function scheduledPushes(
  t: ReturnType<typeof createTestContext>,
): Promise<DeliveredPush[]> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return deliveredPushes;
}

/** Recipients of the `chatMention` push, flattened across jobs. */
async function mentionRecipients(
  t: ReturnType<typeof createTestContext>,
): Promise<string[]> {
  const pushes = await scheduledPushes(t);
  return pushes
    .filter((p) => p.category === "chatMention")
    .flatMap((p) => p.recipientIds);
}

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

/**
 * A mention is a push of the message's first ~100 characters to a user id the
 * *client* chose. Nothing downstream of `notify` re-checks access —
 * `deliverPush` filters by the recipient's own preferences and sends — so the
 * mention list is an access decision, and it has to be made here under the same
 * channel rule that guards `list`. The composer's @-picker is fed workspace
 * members, so an un-narrowed list leaks closed-channel content during ordinary
 * use, not just under attack.
 */
describe("message mention notifications", () => {
  it("does not push a closed-channel message to a mentioned non-member", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });
    const { userId: outsiderId } = await setupWorkspaceOutsider(t, workspaceId);

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "leak-1",
      body: bodyMentioning([outsiderId], "salary review notes"),
      plainText: "@Nosy Colleague salary review notes",
    });

    expect(await mentionRecipients(t)).not.toContain(outsiderId);
  });

  it("still pushes to a mentioned member of the closed channel", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });
    const { userId: insiderId } = await setupChannelMember(t, {
      workspaceId,
      channelId,
      name: "Insider",
      email: "insider@example.com",
    });

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "mention-1",
      body: bodyMentioning([insiderId], "your review is ready"),
      plainText: "@Insider your review is ready",
    });

    expect(await mentionRecipients(t)).toContain(insiderId);
  });

  it("does not push a DM to a mentioned third party", async () => {
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
    const { userId: thirdPartyId } = await setupWorkspaceOutsider(t, workspaceId);

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "dm-leak-1",
      body: bodyMentioning([thirdPartyId], "just between us"),
      plainText: "@Nosy Colleague just between us",
    });

    const recipients = await mentionRecipients(t);
    expect(recipients).not.toContain(thirdPartyId);
  });

  it("pushes to any workspace member mentioned in an open channel", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupOpenChannel(t, workspaceId);
    // No channelMembers row — the open-channel rule admits every workspace member.
    const { userId: colleagueId } = await setupWorkspaceOutsider(t, workspaceId);

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "open-1",
      body: bodyMentioning([colleagueId], "standup in 5"),
      plainText: "@Nosy Colleague standup in 5",
    });

    expect(await mentionRecipients(t)).toContain(colleagueId);
  });

  it("does not push to a mentioned user from another workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupOpenChannel(t, workspaceId);
    // Belongs to no workspace of the sender's — `body` is a free-form string,
    // so any user id in the deployment can be named here.
    const { userId: strangerId } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@example.com",
    });

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "cross-tenant-1",
      body: bodyMentioning([strangerId], "wire the funds to this account"),
      plainText: "@Stranger wire the funds to this account",
    });

    expect(await mentionRecipients(t)).not.toContain(strangerId);
  });

  it("derives the push body from the stored message, not the plainText arg", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });
    const { userId: insiderId } = await setupChannelMember(t, {
      workspaceId,
      channelId,
      name: "Insider",
      email: "insider@example.com",
    });

    // `body` and `plainText` are independent args: what the channel sees and
    // what the notification says need not agree unless the server derives one.
    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "spoof-1",
      body: bodyMentioning([insiderId], "lunch?"),
      plainText: "IT here: reset your password at evil.example",
    });

    const pushes = await scheduledPushes(t);
    for (const push of pushes) {
      expect(push.body).not.toContain("evil.example");
    }
    const mention = pushes.find((p) => p.category === "chatMention");
    expect(mention?.body).toContain("lunch?");
    expect(mention?.body).toContain("@Insider");
  });

  it("ignores mention ids that are not valid user ids", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "garbage-1",
      body: bodyMentioning(["not-an-id" as Id<"users">], "hi"),
      plainText: "@user hi",
    });

    expect(await mentionRecipients(t)).toHaveLength(0);
  });
});
