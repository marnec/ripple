import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  channelFields,
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * "Create task" from selected chat messages: the messages are copied onto the
 * new task as its opening comments. Copying publishes — the task is under the
 * workspace rule — so the capturer must be able to read the channel, and the
 * copies are always the private lane so they never reach a linked issue.
 */

type T = ReturnType<typeof createTestContext>;

async function setup(t: T) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Eng",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "ENG",
      taskCounter: 0,
    });
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return projectId;
  });
  return { workspaceId, userId, asUser, projectId };
}

async function addChannel(
  t: T,
  opts: { workspaceId: Id<"workspaces">; type: "open" | "closed" | "dm"; memberIds: Id<"users">[] },
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: opts.type === "dm" ? "" : "leadership",
      workspaceId: opts.workspaceId,
      ...channelFields(opts.type),
    });
    for (const userId of opts.memberIds) {
      await ctx.db.insert("channelMembers", {
        channelId,
        workspaceId: opts.workspaceId,
        userId,
        role: ChannelRole.ADMIN,
      });
    }
    return channelId;
  });
}

async function addMessage(t: T, channelId: Id<"channels">, userId: Id<"users">, text: string) {
  return t.run((ctx) =>
    ctx.db.insert("messages", {
      channelId,
      userId,
      isomorphicId: `msg-${text}`,
      body: JSON.stringify([{ type: "paragraph", content: [{ type: "text", text }] }]),
      plainText: text,
      deleted: false,
    }),
  );
}

async function addColleague(t: T, workspaceId: Id<"workspaces">) {
  const colleague = await setupAuthenticatedUser(t, { name: "Colleague", email: "c@example.com" });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId: colleague.userId,
      workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );
  return colleague;
}

const page = { numItems: 10, cursor: null };

describe("tasks.create with fromMessageIds", () => {
  it("copies the messages as internal comments, oldest first, quoting their author", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser, projectId } = await setup(t);
    const colleague = await addColleague(t, workspaceId);
    const channelId = await addChannel(t, { workspaceId, type: "open", memberIds: [] });
    const first = await addMessage(t, channelId, colleague.userId, "login is broken");
    const second = await addMessage(t, channelId, userId, "since the deploy");

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Fix login",
      // Out of order on purpose: the comments follow the conversation.
      fromMessageIds: [second, first],
    });

    const comments = await asUser.query(api.taskComments.list, { taskId });
    expect(comments.map((c) => c.quotedFrom?.messageId)).toEqual([first, second]);
    expect(comments[0]).toMatchObject({
      userId,
      internal: true,
      quotedFrom: { channelId, channelName: "leadership", authorName: "Colleague" },
    });
    expect(JSON.parse(comments[0].body)[0].content[0].text).toBe("login is broken");

    // The chat side keeps only the id, for its marker.
    const { page: messages } = await asUser.query(api.messages.list, { channelId, paginationOpts: page });
    expect(messages.every((m) => m.capturedTaskId === taskId)).toBe(true);
  });

  it("names no channel for a DM", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser, projectId } = await setup(t);
    const dmId = await addChannel(t, { workspaceId, type: "dm", memberIds: [userId] });
    const messageId = await addMessage(t, dmId, userId, "between us");

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Follow up",
      fromMessageIds: [messageId],
    });

    const [comment] = await asUser.query(api.taskComments.list, { taskId });
    expect(comment.quotedFrom?.channelName).toBeUndefined();
  });

  it("refuses messages the caller cannot read, and creates no task", async () => {
    const t = createTestContext();
    const { workspaceId, userId, projectId } = await setup(t);
    const colleague = await addColleague(t, workspaceId);
    const dmId = await addChannel(t, { workspaceId, type: "dm", memberIds: [userId] });
    const messageId = await addMessage(t, dmId, userId, "private");

    await expect(
      colleague.asUser.mutation(api.tasks.create, {
        projectId,
        workspaceId,
        title: "Snoop",
        fromMessageIds: [messageId],
      }),
    ).rejects.toThrow(/Not a member of this channel/);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toEqual([]);
  });

  it("refuses messages from two channels", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser, projectId } = await setup(t);
    const a = await addChannel(t, { workspaceId, type: "open", memberIds: [] });
    const b = await addChannel(t, { workspaceId, type: "open", memberIds: [] });

    await expect(
      asUser.mutation(api.tasks.create, {
        projectId,
        workspaceId,
        title: "Mixed",
        fromMessageIds: [await addMessage(t, a, userId, "one"), await addMessage(t, b, userId, "two")],
      }),
    ).rejects.toThrow(/one channel/);
  });

  it("refuses messages from another workspace", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser, projectId } = await setup(t);
    const otherWorkspaceId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaces", { name: "Other", ownerId: userId });
      await ctx.db.insert("workspaceMembers", { userId, workspaceId: id, role: WorkspaceRole.ADMIN });
      return id;
    });
    const channelId = await addChannel(t, { workspaceId: otherWorkspaceId, type: "open", memberIds: [] });
    const messageId = await addMessage(t, channelId, userId, "elsewhere");

    await expect(
      asUser.mutation(api.tasks.create, {
        projectId,
        workspaceId,
        title: "Cross",
        fromMessageIds: [messageId],
      }),
    ).rejects.toThrow(/do not belong to this workspace/);
  });
});
