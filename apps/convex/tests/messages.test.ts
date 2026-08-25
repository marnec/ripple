import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Create a channel in a workspace with the given user as admin member. */
async function setupChannel(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    name?: string;
  },
) {
  const { workspaceId, userId, name = "general" } = opts;

  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name,
      workspaceId,
      type: "open" as const,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId,
      userId,
      role: ChannelRole.ADMIN,
    });
    return channelId;
  });
}

/**
 * A second signed-in user who belongs to the workspace but authored nothing.
 * The channels here are `open`, so workspace membership is the whole channel
 * rule for them — which is what lets the author-only checks be reached.
 */
async function setupOtherMember(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Other",
    email: "other@test.com",
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return asUser;
}

/** Send a message via the mutation and return its ID. */
async function sendMessage(
  asUser: ReturnType<ReturnType<typeof createTestContext>["withIdentity"]>,
  channelId: Id<"channels">,
  text: string,
) {
  await asUser.mutation(api.messages.send, {
    isomorphicId: crypto.randomUUID(),
    body: JSON.stringify([{ type: "paragraph", content: [{ type: "text", text }] }]),
    plainText: text,
    channelId,
  });
}

describe("messages.send", () => {
  it("creates a message in the channel", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Hello world");

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].plainText).toBe("Hello world");
    expect(messages[0].deleted).toBe(false);
    expect(messages[0].userId).toEqual(userId);
  });

  it("rejects unauthenticated users", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await expect(
      t.mutation(api.messages.send, {
        isomorphicId: "test-id",
        body: "{}",
        plainText: "test",
        channelId,
      }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    await expect(
      sendMessage(asStranger, channelId, "Forbidden"),
    ).rejects.toThrow("Not a member of this workspace");
  });
});

describe("messages.update", () => {
  it("allows author to update their message", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Original");

    const msg = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).first(),
    );

    await asUser.mutation(api.messages.update, {
      id: msg!._id,
      body: "updated body",
      plainText: "Updated",
    });

    const updated = await t.run(async (ctx) => ctx.db.get(msg!._id));
    expect(updated?.plainText).toBe("Updated");
  });

  it("rejects updates from non-authors", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "My message");

    const msg = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).first(),
    );

    // A real member of the workspace: `update` takes the channel rule first and
    // authorship second, so a caller with no membership at all is refused by the
    // rule and never reaches the check this test is about. See the ordering note
    // on `update` in convex/messages.ts.
    const asOther = await setupOtherMember(t, workspaceId);

    await expect(
      asOther.mutation(api.messages.update, {
        id: msg!._id,
        body: "hacked",
        plainText: "hacked",
      }),
    ).rejects.toThrow("Not authorized to update this message");
  });
});

describe("messages.remove", () => {
  it("soft-deletes the message", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Delete me");

    const msg = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).first(),
    );

    await asUser.mutation(api.messages.remove, { id: msg!._id });

    const deleted = await t.run(async (ctx) => ctx.db.get(msg!._id));
    expect(deleted?.deleted).toBe(true);
  });

  it("rejects deletion from non-authors", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Protected");

    const msg = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).first(),
    );

    // Same as `update` above — the channel rule runs before authorship.
    const asOther = await setupOtherMember(t, workspaceId);

    await expect(
      asOther.mutation(api.messages.remove, { id: msg!._id }),
    ).rejects.toThrow("Not authorized to delete this message");
  });
});

describe("messages.list", () => {
  it("returns messages for workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "First");
    await sendMessage(asUser, channelId, "Second");

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(2);
    // desc order — most recent first
    expect(result.page[0].plainText).toBe("Second");
    expect(result.page[1].plainText).toBe("First");
    expect(result.page[0].author).toBeDefined();
  });

  it("excludes soft-deleted messages", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Keep");
    await sendMessage(asUser, channelId, "Remove");

    // Soft-delete the second message
    const msgs = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    );
    const toDelete = msgs.find((m) => m.plainText === "Remove")!;
    await asUser.mutation(api.messages.remove, { id: toDelete._id });

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].plainText).toBe("Keep");
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    await expect(
      asStranger.query(api.messages.list, {
        channelId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
  });
});

describe("messages.getMessageContext", () => {
  it("returns messages before and after the target", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    // Send 5 messages with slight time gaps
    for (let i = 1; i <= 5; i++) {
      await sendMessage(asUser, channelId, `Message ${i}`);
    }

    // Get all messages to find the middle one
    const allMsgs = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    // Messages are in ascending _creationTime order
    const middleMsg = allMsgs[2]; // "Message 3"

    const result = await asUser.query(api.messages.getMessageContext, {
      messageId: middleMsg._id,
      contextSize: 10,
    });

    // Should contain all 5 messages
    expect(result.messages).toHaveLength(5);
    expect(result.targetMessageId).toEqual(middleMsg._id);
    // Target is at index 2 (2 messages before it)
    expect(result.targetIndex).toBe(2);
    // Messages should be in chronological order
    expect(result.messages[0].plainText).toBe("Message 1");
    expect(result.messages[4].plainText).toBe("Message 5");
  });

  // Sweep #23 — `contextSize` was an unclamped `v.number()` fed to TWO
  // `.take()` calls, so any channel member could turn a deep-link query into a
  // whole-channel read plus six enrichment passes per row.
  it("clamps an oversized contextSize", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    for (let i = 1; i <= 60; i++) {
      await sendMessage(asUser, channelId, `Message ${i}`);
    }

    const allMsgs = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );

    const result = await asUser.query(api.messages.getMessageContext, {
      messageId: allMsgs[0]._id,
      contextSize: 1_000_000,
    });

    // 0 before (target is the oldest) + target + 50 after.
    expect(result.messages).toHaveLength(51);
  });

  it("respects contextSize limit", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    // Send 10 messages
    for (let i = 1; i <= 10; i++) {
      await sendMessage(asUser, channelId, `Message ${i}`);
    }

    const allMsgs = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    const middleMsg = allMsgs[4]; // "Message 5"

    const result = await asUser.query(api.messages.getMessageContext, {
      messageId: middleMsg._id,
      contextSize: 2,
    });

    // 2 before + target + 2 after = 5
    expect(result.messages).toHaveLength(5);
    expect(result.messages[0].plainText).toBe("Message 3");
    expect(result.messages[2].plainText).toBe("Message 5");
    expect(result.messages[4].plainText).toBe("Message 7");
  });

  it("excludes soft-deleted messages from context", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "First");
    await sendMessage(asUser, channelId, "Delete me");
    await sendMessage(asUser, channelId, "Target");
    await sendMessage(asUser, channelId, "Last");

    // Soft-delete "Delete me"
    const allMsgs = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    const toDelete = allMsgs.find((m) => m.plainText === "Delete me")!;
    await asUser.mutation(api.messages.remove, { id: toDelete._id });

    const target = allMsgs.find((m) => m.plainText === "Target")!;
    const result = await asUser.query(api.messages.getMessageContext, {
      messageId: target._id,
      contextSize: 10,
    });

    // "Delete me" should be excluded from before-context
    const plainTexts = result.messages.map((m) => m.plainText);
    expect(plainTexts).not.toContain("Delete me");
    expect(plainTexts).toContain("First");
    expect(plainTexts).toContain("Target");
    expect(plainTexts).toContain("Last");
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    await sendMessage(asUser, channelId, "Secret");

    const msg = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).first(),
    );

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    await expect(
      asStranger.query(api.messages.getMessageContext, {
        messageId: msg!._id,
      }),
    ).rejects.toThrow("Not a member of this workspace");
  });
});

describe("messages.search", () => {
  it("clamps an oversized limit", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    for (let i = 1; i <= 60; i++) {
      await sendMessage(asUser, channelId, `needle ${i}`);
    }

    const results = await asUser.query(api.messages.search, {
      channelId,
      searchTerm: "needle",
      limit: 1_000_000,
    });

    expect(results).toHaveLength(50);
  });

  it("still honours a limit below the ceiling", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });

    for (let i = 1; i <= 10; i++) {
      await sendMessage(asUser, channelId, `needle ${i}`);
    }

    const results = await asUser.query(api.messages.search, {
      channelId,
      searchTerm: "needle",
      limit: 3,
    });

    expect(results).toHaveLength(3);
  });
});

/**
 * Reactions are part of the message payload, not a second query keyed by the
 * ids `list` just returned. That second query's args changed every time a
 * message arrived, so it resubscribed and the client held `undefined` for a
 * round trip — every reaction chip in the channel unmounted and remounted on
 * every send. These pin the join to the message so it cannot drift back out.
 */
describe("messages reactions enrichment", () => {
  /** The single message in `channelId`, whichever query put it there. */
  async function onlyMessageId(t: ReturnType<typeof createTestContext>, channelId: Id<"channels">) {
    const msgs = await t.run((ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    );
    return msgs[0]._id;
  }

  /** A second signed-in workspace member, with their id — `setupOtherMember` returns only the identity. */
  async function setupSecondMember(
    t: ReturnType<typeof createTestContext>,
    workspaceId: Id<"workspaces">,
  ) {
    const { userId, asUser } = await setupAuthenticatedUser(t, {
      name: "Second",
      email: "second@test.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", { userId, workspaceId, role: WorkspaceRole.MEMBER }),
    );
    return { userId, asUser };
  }

  it("returns a message's reactions on the message itself", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "React to me");
    const messageId = await onlyMessageId(t, channelId);

    await asUser.mutation(api.messageReactions.toggle, {
      messageId,
      emoji: "1f44d",
      emojiNative: "👍",
    });

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page[0].reactions).toEqual([
      {
        emoji: "1f44d",
        emojiNative: "👍",
        count: 1,
        userIds: [userId],
        currentUserReacted: true,
      },
    ]);
  });

  it("gives a message with no reactions an empty array, never undefined", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "Plain");

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page[0].reactions).toEqual([]);
  });

  it("resolves currentUserReacted per viewer", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "Whose reaction?");
    const messageId = await onlyMessageId(t, channelId);

    await asUser.mutation(api.messageReactions.toggle, {
      messageId,
      emoji: "1f44d",
      emojiNative: "👍",
    });

    const { asUser: asSecond } = await setupSecondMember(t, workspaceId);
    const forAuthor = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const forOther = await asSecond.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(forAuthor.page[0].reactions[0].currentUserReacted).toBe(true);
    // Same row, same count — only the viewer-specific flag differs.
    expect(forOther.page[0].reactions[0].currentUserReacted).toBe(false);
    expect(forOther.page[0].reactions[0].count).toBe(1);
    expect(forOther.page[0].reactions[0].userIds).toEqual([userId]);
  });

  it("groups by emoji and orders groups by first reaction", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "Two emoji");
    const messageId = await onlyMessageId(t, channelId);
    const { userId: secondId, asUser: asSecond } = await setupSecondMember(t, workspaceId);

    // 👍 first, then ❤️, then a second 👍 — the late join must not reorder the
    // groups, or the chips shuffle under a reader every time someone reacts.
    await asUser.mutation(api.messageReactions.toggle, {
      messageId, emoji: "1f44d", emojiNative: "👍",
    });
    vi.advanceTimersByTime(10);
    await asUser.mutation(api.messageReactions.toggle, {
      messageId, emoji: "2764-fe0f", emojiNative: "❤️",
    });
    vi.advanceTimersByTime(10);
    await asSecond.mutation(api.messageReactions.toggle, {
      messageId, emoji: "1f44d", emojiNative: "👍",
    });

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    const reactions = result.page[0].reactions;
    expect(reactions.map((r) => r.emoji)).toEqual(["1f44d", "2764-fe0f"]);
    expect(reactions[0].count).toBe(2);
    expect(reactions[0].userIds).toEqual([userId, secondId]);
    expect(reactions[1].count).toBe(1);
  });

  it("drops a group once its last reaction is toggled off", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "On then off");
    const messageId = await onlyMessageId(t, channelId);

    const args = { messageId, emoji: "1f44d", emojiNative: "👍" };
    await asUser.mutation(api.messageReactions.toggle, args);
    await asUser.mutation(api.messageReactions.toggle, args);

    const result = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page[0].reactions).toEqual([]);
  });

  it("carries reactions through search and getMessageContext too", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, userId });
    await sendMessage(asUser, channelId, "findme");
    const messageId = await onlyMessageId(t, channelId);

    await asUser.mutation(api.messageReactions.toggle, {
      messageId, emoji: "1f525", emojiNative: "🔥",
    });

    const found = await asUser.query(api.messages.search, { channelId, searchTerm: "findme" });
    expect(found[0].reactions[0].emoji).toBe("1f525");

    const context = await asUser.query(api.messages.getMessageContext, { messageId });
    const target = context.messages[context.targetIndex];
    expect(target.reactions[0].emoji).toBe("1f525");
    expect(target.reactions[0].currentUserReacted).toBe(true);
    expect(target.reactions[0].userIds).toEqual([userId]);
  });
});
