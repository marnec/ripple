import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin, channelFields } from "./helpers";
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
      ...channelFields("closed"),
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
      ...channelFields("dm"),
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
      ...channelFields("open"),
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
 * A message is channel data, so editing and deleting it follow the channel rule
 * — authorship narrows that rule, it does not replace it. Gating on authorship
 * alone meant removal from a channel never revoked write access: the ejected
 * author kept rewriting the body live members are subscribed to for the whole
 * 48h `isMessageEditable` window, and kept the soft-delete forever, on a
 * conversation they can no longer read. `messageReactions.toggle` already has
 * the right shape on this table.
 */
describe("message edits and deletes follow the channel rule", () => {
  /** Author posts in a closed channel, then loses their membership row. */
  async function setupEjectedAuthor(t: ReturnType<typeof createTestContext>) {
    const { userId: adminId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId: adminId });
    const author = await setupChannelMember(t, {
      workspaceId,
      channelId,
      name: "Ex Member",
      email: "ex@example.com",
    });
    const messageId = await insertMessage(t, {
      channelId,
      userId: author.userId,
      text: "the original text",
    });

    return { workspaceId, channelId, messageId, author };
  }

  async function ejectFromChannel(
    t: ReturnType<typeof createTestContext>,
    opts: { channelId: Id<"channels">; userId: Id<"users"> },
  ) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", opts.channelId).eq("userId", opts.userId),
        )
        .first();
      if (row) await ctx.db.delete(row._id);
    });
  }

  it("refuses an update from an author removed from the channel", async () => {
    const t = createTestContext();
    const { channelId, messageId, author } = await setupEjectedAuthor(t);
    await ejectFromChannel(t, { channelId, userId: author.userId });

    await expect(
      author.asUser.mutation(api.messages.update, {
        id: messageId,
        body: "TAMPERED",
        plainText: "TAMPERED",
      }),
      // The channel rule must be reached before the authorship comparison —
      // "Not authorized to update this message" would confirm the id addresses
      // a real message in a channel the caller can no longer see.
    ).rejects.toThrow("Not a member of this channel");

    const stored = await t.run((ctx) => ctx.db.get(messageId));
    expect(stored?.body, "the body live members read must be untouched").toBe("the original text");
    // `plainText` is what `messages.search` indexes, so a silent rewrite here
    // moves the message in every current member's search results too.
    expect(stored?.plainText).toBe("the original text");
  });

  it("refuses a delete from an author removed from the channel", async () => {
    const t = createTestContext();
    const { channelId, messageId, author } = await setupEjectedAuthor(t);
    await ejectFromChannel(t, { channelId, userId: author.userId });

    await expect(
      author.asUser.mutation(api.messages.remove, { id: messageId }),
      // `remove` has no time bound at all, so this one never expires on its own.
    ).rejects.toThrow("Not a member of this channel");

    const stored = await t.run((ctx) => ctx.db.get(messageId));
    expect(stored?.deleted).toBe(false);
  });

  it("refuses both from an author removed from the workspace entirely", async () => {
    const t = createTestContext();
    const { workspaceId, messageId, author } = await setupEjectedAuthor(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", author.userId),
        )
        .first();
      if (row) await ctx.db.delete(row._id);
    });

    await expect(
      author.asUser.mutation(api.messages.update, {
        id: messageId,
        body: "TAMPERED",
        plainText: "TAMPERED",
      }),
    ).rejects.toThrow("Not a member of this workspace");
    await expect(
      author.asUser.mutation(api.messages.remove, { id: messageId }),
    ).rejects.toThrow("Not a member of this workspace");
  });

  it("still refuses a current channel member who is not the author", async () => {
    const t = createTestContext();
    const { workspaceId, channelId, messageId } = await setupEjectedAuthor(t);
    const bystander = await setupChannelMember(t, {
      workspaceId,
      channelId,
      name: "Bystander",
      email: "bystander@example.com",
    });

    // The channel rule is added on top of authorship, not in place of it.
    await expect(
      bystander.asUser.mutation(api.messages.update, {
        id: messageId,
        body: "not mine to edit",
        plainText: "not mine to edit",
      }),
    ).rejects.toThrow("Not authorized to update this message");
    await expect(
      bystander.asUser.mutation(api.messages.remove, { id: messageId }),
    ).rejects.toThrow("Not authorized to delete this message");
  });

  it("still lets the author edit and delete while they are a member", async () => {
    const t = createTestContext();
    const { messageId, author } = await setupEjectedAuthor(t);

    await author.asUser.mutation(api.messages.update, {
      id: messageId,
      body: "second thoughts",
      plainText: "second thoughts",
    });
    expect((await t.run((ctx) => ctx.db.get(messageId)))?.body).toBe("second thoughts");

    await author.asUser.mutation(api.messages.remove, { id: messageId });
    expect((await t.run((ctx) => ctx.db.get(messageId)))?.deleted).toBe(true);
  });
});

/**
 * `replyToId` is a read primitive, not just a pointer: the list/search
 * enrichment resolves it to the parent's author and *current* body and returns
 * that to everyone in the replying message's channel. A parent from another
 * channel would therefore republish gated content — reactively — to an audience
 * the channel rule never admitted, and the message id is all an attacker needs
 * (an ex-member of a closed channel or DM retains plenty). Both sides are
 * closed: `send` refuses a foreign parent, and the read path refuses to resolve
 * one for rows written before that check existed.
 */
describe("reply parents stay inside their own channel", () => {
  /** A closed channel the attacker was in and has since been removed from. */
  async function setupLeakScenario(t: ReturnType<typeof createTestContext>) {
    const { userId: insiderId, workspaceId, asUser: asInsider } =
      await setupWorkspaceWithAdmin(t);
    const closedId = await setupClosedChannel(t, {
      workspaceId,
      userId: insiderId,
    });
    const secretId = await insertMessage(t, {
      channelId: closedId,
      userId: insiderId,
      text: "layoffs on friday",
    });
    const openId = await setupOpenChannel(t, workspaceId);
    const { userId: attackerId, asUser: asAttacker } =
      await setupWorkspaceOutsider(t, workspaceId);
    return {
      workspaceId,
      insiderId,
      asInsider,
      closedId,
      secretId,
      openId,
      attackerId,
      asAttacker,
    };
  }

  it("refuses to send a reply whose parent lives in another channel", async () => {
    const t = createTestContext();
    const { openId, secretId, asAttacker } = await setupLeakScenario(t);

    await expect(
      asAttacker.mutation(api.messages.send, {
        channelId: openId,
        isomorphicId: "leak-1",
        body: "thoughts?",
        plainText: "thoughts?",
        replyToId: secretId,
      }),
    ).rejects.toThrow(/another channel/i);

    const stored = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("undeleted_by_channel", (q) =>
          q.eq("channelId", openId).eq("deleted", false),
        )
        .collect(),
    );
    expect(stored).toHaveLength(0);
  });

  it("refuses a cross-channel parent even for someone in both channels", async () => {
    const t = createTestContext();
    const { openId, secretId, asInsider } = await setupLeakScenario(t);

    // Membership isn't the point: quoting a closed-channel message into an open
    // one republishes it to everyone in the open channel.
    await expect(
      asInsider.mutation(api.messages.send, {
        channelId: openId,
        isomorphicId: "leak-2",
        body: "fyi",
        plainText: "fyi",
        replyToId: secretId,
      }),
    ).rejects.toThrow(/another channel/i);
  });

  it("does not resolve a cross-channel parent already stored on a message", async () => {
    const t = createTestContext();
    const { openId, secretId, attackerId, asAttacker } =
      await setupLeakScenario(t);
    // Written straight to the DB: the shape of a row from before `send`
    // checked, which the read path must still refuse to resolve.
    await t.run((ctx) =>
      ctx.db.insert("messages", {
        channelId: openId,
        userId: attackerId,
        isomorphicId: "legacy-leak",
        body: "thoughts?",
        plainText: "thoughts?",
        deleted: false,
        replyToId: secretId,
      }),
    );

    const result = await asAttacker.query(api.messages.list, {
      channelId: openId,
      paginationOpts: FIRST_PAGE,
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].replyTo).toBeNull();
    expect(JSON.stringify(result.page)).not.toContain("layoffs");
  });

  it("does not resolve a cross-channel parent through getMessageContext", async () => {
    const t = createTestContext();
    const { openId, secretId, attackerId, asAttacker } =
      await setupLeakScenario(t);
    const messageId = await t.run((ctx) =>
      ctx.db.insert("messages", {
        channelId: openId,
        userId: attackerId,
        isomorphicId: "legacy-leak-2",
        body: "thoughts?",
        plainText: "thoughts?",
        deleted: false,
        replyToId: secretId,
      }),
    );

    const context = await asAttacker.query(api.messages.getMessageContext, {
      messageId,
    });

    expect(JSON.stringify(context)).not.toContain("layoffs");
  });

  it("still resolves a reply to a message in the same channel", async () => {
    const t = createTestContext();
    const { openId, insiderId, asAttacker } = await setupLeakScenario(t);
    const parentId = await insertMessage(t, {
      channelId: openId,
      userId: insiderId,
      text: "standup at ten",
    });

    await asAttacker.mutation(api.messages.send, {
      channelId: openId,
      isomorphicId: "reply-ok",
      body: "on my way",
      plainText: "on my way",
      replyToId: parentId,
    });

    const result = await asAttacker.query(api.messages.list, {
      channelId: openId,
      paginationOpts: FIRST_PAGE,
    });
    const reply = result.page.find((m) => m.replyToId === parentId);
    expect(reply?.replyTo).toMatchObject({ plainText: "standup at ten" });
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

  /**
   * The push body is built by resolving the ids in `body` to names — so it is
   * the same read the `list` enrichment performs, except its output leaves the
   * app entirely and lands on a lock screen. A reference the sender pasted from
   * another workspace must render as the bare mention, not as that tenant's
   * project name. Cross-workspace read coverage for the query side lives in
   * `crossWorkspace.access.test.ts`.
   */
  it("does not put another workspace's project name on a lock screen", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupClosedChannel(t, { workspaceId, userId });
    const { userId: insiderId } = await setupChannelMember(t, {
      workspaceId,
      channelId,
      name: "Insider",
      email: "insider@example.com",
    });

    const { userId: bobId } = await setupAuthenticatedUser(t, {
      name: "Bob",
      email: "bob@b.test",
    });
    const foreignProjectId = await t.run(async (ctx) => {
      const otherWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Workspace B",
        ownerId: bobId,
      });
      return ctx.db.insert("projects", {
        name: "Project Bluebird",
        color: "bg-blue-500",
        workspaceId: otherWorkspaceId,
        creatorId: bobId,
        key: "BBB",
        taskCounter: 0,
      });
    });

    await asUser.mutation(api.messages.send, {
      channelId,
      isomorphicId: "foreign-project-1",
      body: JSON.stringify([
        {
          type: "paragraph",
          content: [
            { type: "userMention", props: { userId: insiderId } },
            { type: "text", text: " see ", styles: {} },
            { type: "projectReference", props: { projectId: foreignProjectId } },
          ],
        },
      ]),
      plainText: "@Insider see #Project Bluebird",
    });

    for (const push of await scheduledPushes(t)) {
      expect(push.body).not.toContain("Project Bluebird");
    }
  });
});
