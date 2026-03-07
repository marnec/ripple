import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@shared/enums/roles";
import type { Id } from "../../convex/_generated/dataModel";

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
      isPublic: true,
      roleCount: { admin: 1, member: 0 },
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

    const { asUser: asOther } = await setupAuthenticatedUser(t, {
      name: "Other",
      email: "other@test.com",
    });

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

    const { asUser: asOther } = await setupAuthenticatedUser(t, {
      name: "Other",
      email: "other@test.com",
    });

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
    ).rejects.toThrow("User not authorized");
  });
});
