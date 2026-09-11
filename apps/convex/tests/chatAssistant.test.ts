import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockModel, listMessages } from "@convex-dev/agent";
import { api, components } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { FeatureKey } from "@ripple/shared/enums/features";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  channelFields,
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The workspace assistant answers when @-mentioned in chat — and only then,
 * only in its own workspace, and only while the `ai_assistant` entitlement is
 * on. The model is a `@convex-dev/agent` mock standing in for the Azure
 * OpenAI provider, so the whole path runs: the mention in `messages.send`, the
 * `aiPool` job, the agent thread, the markdown answer landing as a `messages`
 * row authored by the bot user. What the model was *told* is asserted through
 * the mock's recorded calls.
 */

const mocks = vi.hoisted(() => ({
  model: null as null | ReturnType<typeof mockModel>,
}));

vi.mock("@ai-sdk/azure", () => {
  // The factory answers to both accessors — `azure(deployment)` and
  // `azure.chat(deployment)` — so switching between the Responses and Chat
  // Completions surfaces in `lib/aiAgents.ts` does not silently unmock this.
  const resolve = () => {
    if (!mocks.model) throw new Error("test did not install a mock model");
    return mocks.model;
  };
  return {
    createAzure: () =>
      Object.assign(resolve, { chat: resolve, responses: resolve }),
  };
});

const REPLY_MARKDOWN = "The standup is at **10:00**.\n\nBring coffee.";

type MockLanguageModel = ReturnType<typeof mockModel> & {
  doGenerateCalls: { prompt: unknown[] }[];
};

function installModel(text = REPLY_MARKDOWN): MockLanguageModel {
  mocks.model = mockModel({ content: [{ type: "text", text }] });
  return mocks.model as MockLanguageModel;
}

/** Every Azure variable `readAiConfig` requires, and its saved value. */
const AI_ENV = ["AZURE_API_KEY", "AZURE_RESOURCE_NAME", "AZURE_OPENAI_DEPLOYMENT"] as const;
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  vi.useFakeTimers();
  savedEnv = Object.fromEntries(AI_ENV.map((key) => [key, process.env[key]]));
  for (const key of AI_ENV) process.env[key] = `test-${key}`;
  installModel();
});
afterEach(() => {
  vi.useRealTimers();
  for (const key of AI_ENV) {
    const saved = savedEnv[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  mocks.model = null;
});

/** A BlockNote body: an optional @mention followed by text. */
function body(text: string, mentionUserId?: string): string {
  const content: unknown[] = [];
  if (mentionUserId) {
    content.push({ type: "userMention", props: { userId: mentionUserId } });
    content.push({ type: "text", text: " ", styles: {} });
  }
  content.push({ type: "text", text, styles: {} });
  return JSON.stringify([
    { id: "b1", type: "paragraph", props: {}, content, children: [] },
  ]);
}

let seq = 0;
async function send(
  as: ReturnType<ReturnType<typeof createTestContext>["withIdentity"]>,
  channelId: Id<"channels">,
  text: string,
  mentionUserId?: string,
) {
  await as.mutation(api.messages.send, {
    isomorphicId: `iso-${++seq}`,
    body: body(text, mentionUserId),
    plainText: text,
    channelId,
  });
}

/** A workspace with the feature on and its assistant created by the toggle. */
async function setupAssistantWorkspace(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
    workspaceId,
    featureKey: FeatureKey.AI_ASSISTANT,
    enabled: true,
  });
  const assistant = await asUser.query(api.chatAssistant.get, { workspaceId });
  if (!assistant) throw new Error("enabling the feature did not create the assistant");
  const channelId = await t.run((ctx) =>
    ctx.db.insert("channels", {
      name: "general",
      workspaceId,
      ...channelFields("open"),
    }),
  );
  return { userId, workspaceId, asUser, channelId, botUserId: assistant.botUserId };
}

async function drain(t: ReturnType<typeof createTestContext>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function channelMessages(
  t: ReturnType<typeof createTestContext>,
  channelId: Id<"channels">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect(),
  );
}

describe("enabling the assistant", () => {
  it("gives the workspace a bot user the composer can offer", async () => {
    const t = createTestContext();
    const { botUserId, asUser, workspaceId } = await setupAssistantWorkspace(t);

    const bot = await t.run((ctx) => ctx.db.get(botUserId));
    expect(bot?.isBot).toBe(true);
    expect(bot?.name).toBeTruthy();

    const assistant = await asUser.query(api.chatAssistant.get, { workspaceId });
    expect(assistant).toEqual({ botUserId, name: bot?.name });
  });

  it("creates one assistant however many times the feature is toggled", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, botUserId } = await setupAssistantWorkspace(t);

    for (const enabled of [false, true, true]) {
      await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
        workspaceId,
        featureKey: FeatureKey.AI_ASSISTANT,
        enabled,
      });
    }

    const rows = await t.run((ctx) =>
      ctx.db
        .query("workspaceAssistants")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    );
    expect(rows.map((r) => r.botUserId)).toEqual([botUserId]);
  });

  it("hides the assistant from the composer while the feature is off", async () => {
    const t = createTestContext();
    const { asUser, workspaceId } = await setupAssistantWorkspace(t);

    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: FeatureKey.AI_ASSISTANT,
      enabled: false,
    });

    expect(await asUser.query(api.chatAssistant.get, { workspaceId })).toBeNull();
  });

  it("is not visible to someone outside the workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupAssistantWorkspace(t);
    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      email: "stranger@example.com",
    });

    await expect(
      asStranger.query(api.chatAssistant.get, { workspaceId }),
    ).rejects.toThrow();
  });
});

describe("a mention of the assistant", () => {
  it("is answered in the channel, by the bot user, as a reply to the mention", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId, userId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "when is the standup?", botUserId);
    await drain(t);

    const messages = await channelMessages(t, channelId);
    expect(messages).toHaveLength(2);
    const [mention, reply] = messages;
    expect(mention.userId).toBe(userId);
    expect(reply.userId).toBe(botUserId);
    expect(reply.replyToId).toBe(mention._id);
    expect(reply.deleted).toBe(false);
    expect(reply.plainText).toBe(REPLY_MARKDOWN);

    // The markdown became BlockNote blocks the chat renders, bold and all.
    const blocks = JSON.parse(reply.body) as { type: string; content: unknown[] }[];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(blocks)).toContain('"bold":true');
  });

  it("shows up in the channel list like any other message", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "hello there", botUserId);
    await drain(t);

    const page = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const reply = page.page.find((m) => m.userId === botUserId);
    expect(reply).toBeDefined();
    expect(reply?.replyTo?.plainText).toContain("hello there");
  });

  it("gives the model the channel since its last reply, with the mention marked", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);
    const { userId: bobId, asUser: asBob } = await setupAuthenticatedUser(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    await t.run(async (ctx) => {
      const channel = await ctx.db.get(channelId);
      await ctx.db.insert("workspaceMembers", {
        userId: bobId,
        workspaceId: channel!.workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await send(asBob, channelId, "standup moved to ten");
    await send(asUser, channelId, "noted");
    const first = installModel("Got it.");
    await send(asUser, channelId, "when is the standup?", botUserId);
    await drain(t);

    expect(first.doGenerateCalls).toHaveLength(1);
    const firstPrompt = JSON.stringify(first.doGenerateCalls[0].prompt);
    expect(firstPrompt).toContain("Bob: standup moved to ten");
    expect(firstPrompt).toContain("Test User: noted");
    expect(firstPrompt).toContain("[mentions you]: @Assistant when is the standup?");

    // The next mention only carries what came after the assistant's answer;
    // the earlier exchange reaches the model as thread history instead.
    await send(asBob, channelId, "and bring the deck");
    const second = installModel("Will do.");
    await send(asBob, channelId, "did you get that?", botUserId);
    await drain(t);

    expect(second.doGenerateCalls).toHaveLength(1);
    const prompt = second.doGenerateCalls[0].prompt;
    const lastUserTurn = JSON.stringify(prompt.at(-1));
    expect(lastUserTurn).toContain("Bob: and bring the deck");
    expect(lastUserTurn).toContain("[mentions you]: @Assistant did you get that?");
    expect(lastUserTurn).not.toContain("standup moved to ten");
    const wholePrompt = JSON.stringify(prompt);
    expect(wholePrompt).toContain("standup moved to ten");
    expect(wholePrompt).toContain("Got it.");
  });

  it("keeps the exchange in the channel's agent thread", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "ping", botUserId);
    await drain(t);
    await send(asUser, channelId, "pong?", botUserId);
    await drain(t);

    const threads = await t.run((ctx) =>
      ctx.db
        .query("assistantChannelThreads")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(threads).toHaveLength(1);

    const history = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: threads[0].threadId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    const roles = history.page.map((m) => m.message?.role);
    expect(roles.filter((r) => r === "user")).toHaveLength(2);
    expect(roles.filter((r) => r === "assistant")).toHaveLength(2);
  });

  it("answers in a closed channel it is not a member of", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, botUserId } = await setupAssistantWorkspace(t);
    const closedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        name: "leadership",
        workspaceId,
        ...channelFields("closed"),
      });
      await ctx.db.insert("channelMembers", {
        channelId: id,
        workspaceId,
        userId,
        role: ChannelRole.ADMIN,
      });
      return id;
    });

    await send(asUser, closedId, "summarize this", botUserId);
    await drain(t);

    const messages = await channelMessages(t, closedId);
    expect(messages.map((m) => m.userId)).toEqual([userId, botUserId]);
  });
});

describe("no reply", () => {
  it("when the message mentions only people", async () => {
    const t = createTestContext();
    const { asUser, channelId, userId } = await setupAssistantWorkspace(t);
    const model = installModel();

    await send(asUser, channelId, "hey", userId);
    await send(asUser, channelId, "nobody mentioned");
    await drain(t);

    expect(model.doGenerateCalls).toHaveLength(0);
    const messages = await channelMessages(t, channelId);
    expect(messages).toHaveLength(2);
  });

  it("when the feature is off, even though the bot user still exists", async () => {
    const t = createTestContext();
    const { asUser, channelId, workspaceId, botUserId } = await setupAssistantWorkspace(t);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: FeatureKey.AI_ASSISTANT,
      enabled: false,
    });
    const model = installModel();

    await send(asUser, channelId, "are you there?", botUserId);
    await drain(t);

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await channelMessages(t, channelId)).toHaveLength(1);
  });

  it("when the feature is switched off while the reply is queued", async () => {
    const t = createTestContext();
    const { asUser, channelId, workspaceId, botUserId } = await setupAssistantWorkspace(t);
    const model = installModel();

    await send(asUser, channelId, "are you there?", botUserId);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: FeatureKey.AI_ASSISTANT,
      enabled: false,
    });
    await drain(t);

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await channelMessages(t, channelId)).toHaveLength(1);
  });

  it("when the mention is deleted before the model answers", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "never mind", botUserId);
    const [mention] = await channelMessages(t, channelId);
    await asUser.mutation(api.messages.remove, { id: mention._id });
    await drain(t);

    const messages = await channelMessages(t, channelId);
    expect(messages.filter((m) => m.userId === botUserId)).toHaveLength(0);
  });

  it("when another workspace's assistant is mentioned", async () => {
    const t = createTestContext();
    const { asUser, channelId } = await setupAssistantWorkspace(t);
    const model = installModel();

    // A second workspace with its own assistant, whose id the first
    // workspace's member pastes into a mention.
    const { asUser: asOther, workspaceId: otherWorkspaceId } =
      await setupWorkspaceWithAdmin(t, "Other");
    await asOther.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId: otherWorkspaceId,
      featureKey: FeatureKey.AI_ASSISTANT,
      enabled: true,
    });
    const other = await asOther.query(api.chatAssistant.get, {
      workspaceId: otherWorkspaceId,
    });

    await send(asUser, channelId, "come here", other!.botUserId);
    await drain(t);

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await channelMessages(t, channelId)).toHaveLength(1);
  });

  it("when the workspace has spent its hourly budget", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    // The bucket holds ten; the eleventh mention in a burst gets nothing.
    for (let i = 0; i < 11; i++) {
      await send(asUser, channelId, `question ${i}`, botUserId);
    }
    await drain(t);

    const replies = (await channelMessages(t, channelId)).filter(
      (m) => m.userId === botUserId,
    );
    expect(replies).toHaveLength(10);
  });

  it("when the model answers with nothing", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);
    installModel("   ");

    await send(asUser, channelId, "say nothing", botUserId);
    await drain(t);

    expect(await channelMessages(t, channelId)).toHaveLength(1);
  });
});

describe("while a reply is on its way", () => {
  async function pending(
    as: ReturnType<ReturnType<typeof createTestContext>["withIdentity"]>,
    channelId: Id<"channels">,
  ) {
    return as.query(api.chatAssistant.pendingReplies, { channelId });
  }

  it("the channel shows the assistant as writing, until the reply lands", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "when is the standup?", botUserId);
    const [mention] = await channelMessages(t, channelId);
    const before = await pending(asUser, channelId);
    expect(before).toHaveLength(1);
    expect(before[0].messageId).toBe(mention._id);
    // Its own row's clock, written in the mention's transaction: the same
    // instant to a reader, not the same float.
    expect(before[0].since).toBeGreaterThanOrEqual(mention._creationTime);
    expect(before[0].since - mention._creationTime).toBeLessThan(1_000);

    await drain(t);

    expect(await pending(asUser, channelId)).toEqual([]);
    expect(await channelMessages(t, channelId)).toHaveLength(2);
  });

  it("is one entry per mention waiting, not one per channel", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "first", botUserId);
    await send(asUser, channelId, "second", botUserId);

    expect(await pending(asUser, channelId)).toHaveLength(2);
    await drain(t);
    expect(await pending(asUser, channelId)).toEqual([]);
  });

  it("nothing is shown for a message that does not summon the assistant", async () => {
    const t = createTestContext();
    const { asUser, channelId, userId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "hey", userId);

    expect(await pending(asUser, channelId)).toEqual([]);
  });

  it("stops when the model answers with nothing", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);
    installModel("   ");

    await send(asUser, channelId, "say nothing", botUserId);
    expect(await pending(asUser, channelId)).toHaveLength(1);
    await drain(t);

    expect(await pending(asUser, channelId)).toEqual([]);
  });

  it("stops when the feature is switched off while the reply is queued", async () => {
    const t = createTestContext();
    const { asUser, channelId, workspaceId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "are you there?", botUserId);
    await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
      workspaceId,
      featureKey: FeatureKey.AI_ASSISTANT,
      enabled: false,
    });
    await drain(t);

    expect(await pending(asUser, channelId)).toEqual([]);
  });

  it("stops when the mention is deleted before the model answers", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "never mind", botUserId);
    const [mention] = await channelMessages(t, channelId);
    await asUser.mutation(api.messages.remove, { id: mention._id });
    await drain(t);

    expect(await pending(asUser, channelId)).toEqual([]);
  });

  it("stops when the job fails for good, and the failure is still recorded", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);
    delete process.env.AZURE_API_KEY;

    await send(asUser, channelId, "hello?", botUserId);
    expect(await pending(asUser, channelId)).toHaveLength(1);
    await drain(t);

    expect(await pending(asUser, channelId)).toEqual([]);
    const failures = await t.run((ctx) => ctx.db.query("backgroundJobFailures").collect());
    expect(failures.map((f) => f.kind)).toEqual(["chatAssistantAction:reply"]);
  });

  it("is channel content: a colleague outside a closed channel cannot see it", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, botUserId } = await setupAssistantWorkspace(t);
    const closedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        name: "leadership",
        workspaceId,
        ...channelFields("closed"),
      });
      await ctx.db.insert("channelMembers", {
        channelId: id,
        workspaceId,
        userId,
        role: ChannelRole.ADMIN,
      });
      return id;
    });
    const { userId: bobId, asUser: asBob } = await setupAuthenticatedUser(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: bobId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    await send(asUser, closedId, "summarize this", botUserId);

    expect(await pending(asUser, closedId)).toHaveLength(1);
    await expect(pending(asBob, closedId)).rejects.toThrow();
  });

  it("goes with the channel when the channel is deleted", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "hi", botUserId);
    await asUser.mutation(api.channels.remove, { id: channelId });
    await drain(t);

    const rows = await t.run((ctx) => ctx.db.query("assistantPendingReplies").collect());
    expect(rows).toEqual([]);
  });
});

describe("without an API key", () => {
  it("the job fails once and is recorded, and the channel is untouched", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);
    const model = installModel();
    delete process.env.AZURE_API_KEY;

    await send(asUser, channelId, "hello?", botUserId);
    await drain(t);

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await channelMessages(t, channelId)).toHaveLength(1);
    const failures = await t.run((ctx) => ctx.db.query("backgroundJobFailures").collect());
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("chatAssistantAction:reply");
  });
});

describe("deleting a channel", () => {
  it("removes its assistant thread with it", async () => {
    const t = createTestContext();
    const { asUser, channelId, botUserId } = await setupAssistantWorkspace(t);

    await send(asUser, channelId, "hi", botUserId);
    await drain(t);
    const before = await t.run((ctx) =>
      ctx.db.query("assistantChannelThreads").collect(),
    );
    expect(before).toHaveLength(1);

    await asUser.mutation(api.channels.remove, { id: channelId });
    await drain(t);

    const after = await t.run((ctx) =>
      ctx.db.query("assistantChannelThreads").collect(),
    );
    expect(after).toHaveLength(0);
  });
});
