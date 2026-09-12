import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockModel } from "@convex-dev/agent";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { FeatureKey } from "@ripple/shared/enums/features";
import { ChannelRole } from "@ripple/shared/enums/roles";
import { channelFields, createTestContext, setupProject, setupWorkspaceWithAdmin } from "./helpers";
import { gridSnapshot, paragraphSnapshot } from "./yjsFixtures";

/**
 * The workspace assistant reading the workspace to answer a mention —
 * **fetched context** through the **assistant tools**, as the **summoner**.
 * Driven from the top: a mention goes in through the public send mutation,
 * a scripted model calls a tool on its first step and answers on its second,
 * the pools drain, and the reply is read back as a channel message. What the
 * tool returned is visible in the prompt of the second model call.
 */

const mocks = vi.hoisted(() => ({
  model: null as null | ReturnType<typeof mockModel>,
}));

vi.mock("@ai-sdk/azure", () => {
  const resolve = () => {
    if (!mocks.model) throw new Error("test did not install a mock model");
    return mocks.model;
  };
  return {
    createAzure: () => Object.assign(resolve, { chat: resolve, responses: resolve }),
  };
});

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

type MockLanguageModel = ReturnType<typeof mockModel> & {
  doGenerateCalls: { prompt: unknown }[];
};

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * A model that calls `toolName` with `input` on its first step and answers
 * `reply` on its second. Spelled out in the provider's current shape, like
 * the writing assistant's tool tests.
 */
function installToolCallingModel(
  toolName: string,
  input: Record<string, unknown>,
  reply: string,
): MockLanguageModel {
  const steps = [
    {
      content: [{ type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) }],
      finishReason: { unified: "tool-calls" },
    },
    { content: [{ type: "text", text: reply }], finishReason: { unified: "stop" } },
  ];
  let call = 0;
  mocks.model = mockModel({
    doGenerate: async () => ({
      ...steps[Math.min(call++, steps.length - 1)],
      usage: USAGE,
      warnings: [],
    }),
  } as never);
  return mocks.model as MockLanguageModel;
}

/**
 * A model that reads on every reply: a tool call whenever the last turn is
 * not a tool result, an answer when it is. Unlike `installToolCallingModel`
 * it does not count calls, so the second, third, … replies read too.
 */
function installAlwaysReadingModel(
  toolName: string,
  input: Record<string, unknown>,
  reply: string,
): MockLanguageModel {
  mocks.model = mockModel({
    doGenerate: async ({ prompt }: { prompt: { role: string }[] }) => ({
      ...(prompt.at(-1)?.role === "tool"
        ? { content: [{ type: "text", text: reply }], finishReason: { unified: "stop" } }
        : {
            content: [{ type: "tool-call", toolCallId: `call-${prompt.length}`, toolName, input: JSON.stringify(input) }],
            finishReason: { unified: "tool-calls" },
          }),
      usage: USAGE,
      warnings: [],
    }),
  } as never);
  return mocks.model as MockLanguageModel;
}

/** A model that answers `reply` without reading anything. */
function installTextModel(reply: string): MockLanguageModel {
  mocks.model = mockModel({ content: [{ type: "text", text: reply }] });
  return mocks.model as MockLanguageModel;
}

function prompt(model: MockLanguageModel, step: number): string {
  expect(model.doGenerateCalls.length).toBeGreaterThan(step);
  return JSON.stringify(model.doGenerateCalls[step].prompt);
}

const AI_ENV = ["AZURE_API_KEY", "AZURE_RESOURCE_NAME", "AZURE_OPENAI_DEPLOYMENT"] as const;
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  vi.useFakeTimers();
  savedEnv = Object.fromEntries(AI_ENV.map((key) => [key, process.env[key]]));
  for (const key of AI_ENV) process.env[key] = `test-${key}`;
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

type T = ReturnType<typeof createTestContext>;

/** A BlockNote body: an @mention of the assistant followed by text. */
function mentionBody(botUserId: string, text: string): string {
  return JSON.stringify([
    {
      id: "b1",
      type: "paragraph",
      props: {},
      content: [
        { type: "userMention", props: { userId: botUserId } },
        { type: "text", text: ` ${text}`, styles: {} },
      ],
      children: [],
    },
  ]);
}

/** A body carrying one reference chip, the way the `#` picker writes it. */
function chipBody(chip: { resourceId: string; resourceType: string; resourceName: string }, text: string): string {
  return JSON.stringify([
    {
      id: "b1",
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: `${text} `, styles: {} },
        { type: "resourceReference", props: chip },
      ],
      children: [],
    },
  ]);
}

/** A body that mentions the assistant and carries reference chips. */
function mentionWithChips(
  botUserId: string,
  text: string,
  chips: { type: string; props: Record<string, string> }[],
): string {
  return JSON.stringify([
    {
      id: "b1",
      type: "paragraph",
      props: {},
      content: [
        { type: "userMention", props: { userId: botUserId } },
        { type: "text", text: ` ${text} `, styles: {} },
        ...chips,
      ],
      children: [],
    },
  ]);
}

let seq = 0;
async function setupAssistantWorkspace(t: T) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  await asUser.mutation(api.integrations.core.entitlements.setWorkspaceFeature, {
    workspaceId,
    featureKey: FeatureKey.AI_ASSISTANT,
    enabled: true,
  });
  const assistant = await asUser.query(api.chatAssistant.get, { workspaceId });
  if (!assistant) throw new Error("enabling the feature did not create the assistant");
  const channelId = await t.run((ctx) =>
    ctx.db.insert("channels", { name: "general", workspaceId, ...channelFields("open") }),
  );
  const summon = async (text: string) => {
    await asUser.mutation(api.messages.send, {
      isomorphicId: `iso-${++seq}`,
      body: mentionBody(assistant.botUserId, text),
      plainText: text,
      channelId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  /** Summon with reference chips in the same message. */
  const summonWith = async (
    text: string,
    chips: { type: string; props: Record<string, string> }[],
  ) => {
    await asUser.mutation(api.messages.send, {
      isomorphicId: `iso-${++seq}`,
      body: mentionWithChips(assistant.botUserId, text, chips),
      plainText: text,
      channelId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  /** Post a message as the member, without mentioning the assistant. */
  const post = async (body: string, plainText: string) => {
    await asUser.mutation(api.messages.send, {
      isomorphicId: `iso-${++seq}`,
      body,
      plainText,
      channelId,
    });
  };
  const reply = async () => {
    const messages = await t.run((ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    );
    return messages.find((m) => m.userId === assistant.botUserId) ?? null;
  };
  return {
    userId, workspaceId, asUser, channelId, botUserId: assistant.botUserId,
    summon, summonWith, post, reply,
  };
}

async function insertDocument(
  t: T,
  workspaceId: Id<"workspaces">,
  name: string,
  snapshotText?: string,
): Promise<Id<"documents">> {
  return t.run(async (ctx) => {
    const yjsSnapshotId = snapshotText
      ? await ctx.storage.store(new Blob([paragraphSnapshot(snapshotText)]))
      : undefined;
    return ctx.db.insert("documents", { workspaceId, name, yjsSnapshotId });
  });
}

describe("the instructions", () => {
  it("describe the tools and the Sources rule instead of a channel-only view", async () => {
    const t = createTestContext();
    const { summon } = await setupAssistantWorkspace(t);
    const model = installToolCallingModel("search_workspace", { query: "x" }, "nothing");

    await summon("anything");

    const system = prompt(model, 0);
    expect(system).not.toContain("You can only see this channel's messages");
    expect(system).toContain("read_document");
    expect(system).toContain("Sources");
    expect(system).toMatch(/cannot find|could not find|not able to find|can't find/i);
  });
});

describe("a mention answered with a tool read", () => {
  it("gives the model the document it asked for and posts the reply", async () => {
    const t = createTestContext();
    const { workspaceId, summon, reply } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship the assistant in Q4.");
    const model = installToolCallingModel(
      "read_document",
      { documentId: roadmapId },
      "It ships in Q4.\n\nSources: Roadmap",
    );

    await summon("what does the roadmap say?");

    expect(prompt(model, 1)).toContain("Ship the assistant in Q4.");
    const posted = await reply();
    expect(posted?.plainText).toBe("It ships in Q4.\n\nSources: Roadmap");

    const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(2);
  });
});

describe("the reply budget", () => {
  it("is spent once per reply, however many steps a reply takes", async () => {
    const t = createTestContext();
    const { workspaceId, channelId, botUserId, asUser } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship the assistant in Q4.");
    installAlwaysReadingModel("read_document", { documentId: roadmapId }, "It ships in Q4.");

    // The bucket holds ten replies. Each reply here is two model steps; if
    // steps were what the budget counted, the sixth mention would go quiet.
    // One burst, then one drain: draining between mentions advances the
    // clock and refills the bucket.
    for (let i = 0; i < 11; i++) {
      await asUser.mutation(api.messages.send, {
        isomorphicId: `iso-${++seq}`,
        body: mentionBody(botUserId, `question ${i}`),
        plainText: `question ${i}`,
        channelId,
      });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const replies = (
      await t.run((ctx) =>
        ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
      )
    ).filter((m) => m.userId === botUserId);
    expect(replies).toHaveLength(10);

    const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(20);
  });
});

const REFUSAL = "Not found, or you do not have access to it.";

describe("what the model is given", () => {
  it("renders an earlier chip as its name, type and id so a tool can reach it", async () => {
    const t = createTestContext();
    const { workspaceId, summon, post } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship in Q4.");
    await post(
      chipBody({ resourceId: roadmapId, resourceType: "document", resourceName: "Roadmap" }, "see"),
      "see #Roadmap",
    );
    const model = installToolCallingModel("read_document", { documentId: roadmapId }, "Q4.");

    await summon("is that realistic?");

    expect(prompt(model, 0)).toContain(`#Roadmap (document ${roadmapId})`);
  });
});

describe("what a tool may read", () => {
  it("refuses a private channel the summoner is not in, and still replies", async () => {
    const t = createTestContext();
    const { workspaceId, summon, reply } = await setupAssistantWorkspace(t);
    const { userId: insiderId } = await setupWorkspaceWithAdmin(t, "Unused");
    const privateId = await t.run(async (ctx) => {
      const channelId = await ctx.db.insert("channels", {
        name: "leadership", workspaceId, ...channelFields("closed"),
      });
      await ctx.db.insert("channelMembers", {
        channelId, userId: insiderId, workspaceId, role: ChannelRole.MEMBER,
      });
      await ctx.db.insert("messages", {
        userId: insiderId, channelId, isomorphicId: "m-x", deleted: false,
        body: "[]", plainText: "Layoffs on Monday.",
      });
      return channelId;
    });
    const model = installToolCallingModel(
      "read_channel_messages",
      { channelId: privateId },
      "I can't access that channel.",
    );

    await summon("what did leadership discuss?");

    const second = prompt(model, 1);
    expect(second).toContain(REFUSAL);
    expect(second).not.toContain("Layoffs on Monday.");
    expect((await reply())?.plainText).toBe("I can't access that channel.");
  });

  it("refuses a document from another workspace", async () => {
    const t = createTestContext();
    const { workspaceId: theirs } = await setupWorkspaceWithAdmin(t, "Theirs");
    const secretId = await insertDocument(t, theirs, "Secret", "Salary bands.");
    const { summon } = await setupAssistantWorkspace(t);
    const model = installToolCallingModel("read_document", { documentId: secretId }, "No.");

    await summon("read the secret doc");

    const second = prompt(model, 1);
    expect(second).toContain(REFUSAL);
    expect(second).not.toContain("Salary bands.");
  });

  it("reads a document nobody has written into as empty", async () => {
    const t = createTestContext();
    const { workspaceId, summon } = await setupAssistantWorkspace(t);
    const blankId = await insertDocument(t, workspaceId, "Blank");
    const model = installToolCallingModel("read_document", { documentId: blankId }, "Empty.");

    await summon("what's in Blank?");

    const second = prompt(model, 1);
    expect(second).toContain('"content":""');
    expect(second).not.toContain(REFUSAL);
  });

  it("clips a long document at the chat limit and says so", async () => {
    const t = createTestContext();
    const { workspaceId, summon } = await setupAssistantWorkspace(t);
    const longId = await insertDocument(t, workspaceId, "Long", "x".repeat(40_000));
    const model = installToolCallingModel("read_document", { documentId: longId }, "Long.");

    await summon("summarise Long");

    const second = prompt(model, 1);
    expect(second).toContain("[truncated]");
    expect(second.length).toBeLessThan(35_000);
  });
});

describe("the step limit", () => {
  it("still posts an answer when the model would keep reading", async () => {
    const t = createTestContext();
    const { workspaceId, summon, reply } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship in Q4.");
    // Always asks for another read; only answers once it is told it may not.
    let calls = 0;
    mocks.model = mockModel({
      doGenerate: async (options: { toolChoice?: { type: string }; tools?: unknown[] }) => {
        calls++;
        const mayCall = (options.tools?.length ?? 0) > 0 && options.toolChoice?.type !== "none";
        return mayCall
          ? {
              content: [
                {
                  type: "tool-call",
                  toolCallId: `call-${calls}`,
                  toolName: "read_document",
                  input: JSON.stringify({ documentId: roadmapId }),
                },
              ],
              finishReason: { unified: "tool-calls" },
              usage: USAGE,
              warnings: [],
            }
          : {
              content: [{ type: "text", text: "Q4, as far as I read." }],
              finishReason: { unified: "stop" },
              usage: USAGE,
              warnings: [],
            };
      },
    } as never);

    await summon("keep digging");

    expect((await reply())?.plainText).toBe("Q4, as far as I read.");
    // Six steps of reading, then one forced answer.
    expect(calls).toBe(7);
  });
});

const documentChip = (resourceId: string, resourceName: string) => ({
  type: "resourceReference",
  props: { resourceId, resourceType: "document", resourceName },
});

describe("referenced context", () => {
  it("preloads a chipped document's text into the first prompt", async () => {
    const t = createTestContext();
    const { workspaceId, summonWith, reply } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship the assistant in Q4.");
    const model = installTextModel("It ships in Q4.");

    await summonWith("summarise", [documentChip(roadmapId, "Roadmap")]);

    const first = prompt(model, 0);
    expect(first).toContain("Ship the assistant in Q4.");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await reply())?.plainText).toBe("It ships in Q4.");
  });
});

describe("referenced context, edge by edge", () => {
  it("preloads a chipped task's fields and description", async () => {
    const t = createTestContext();
    const { workspaceId, userId, summonWith } = await setupAssistantWorkspace(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const taskId = await t.run(async (ctx) => {
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "In progress", color: "bg-blue-500", order: 0,
        isDefault: true, isCompleted: false,
      });
      const yjsSnapshotId = await ctx.storage.store(
        new Blob([paragraphSnapshot("Rotate the signing key.")]),
      );
      return ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Key rotation", statusId,
        priority: "high", completed: false, creatorId: userId, yjsSnapshotId,
      });
    });
    const model = installTextModel("On it.");

    await summonWith("status?", [{ type: "taskMention", props: { taskId, taskTitle: "Key rotation" } }]);

    const first = prompt(model, 0);
    expect(first).toContain(`Key rotation (task ${taskId})`);
    expect(first).toContain("In progress");
    expect(first).toContain("Rotate the signing key.");
  });

  it("preloads at most five chips; the sixth stays reachable by id", async () => {
    const t = createTestContext();
    const { workspaceId, summonWith } = await setupAssistantWorkspace(t);
    const chips = [];
    for (let i = 1; i <= 6; i++) {
      const id = await insertDocument(t, workspaceId, `Doc ${i}`, `Body of doc ${i}.`);
      chips.push(documentChip(id, `Doc ${i}`));
    }
    const model = installTextModel("Read.");

    await summonWith("compare", chips);

    const first = prompt(model, 0);
    for (let i = 1; i <= 5; i++) expect(first).toContain(`Body of doc ${i}.`);
    expect(first).not.toContain("Body of doc 6.");
    expect(first).toContain(`#Doc 6 (document ${chips[5].props.resourceId})`);
  });

  it("marks a chipped diagram as referenced but not readable", async () => {
    const t = createTestContext();
    const { workspaceId, summonWith, reply } = await setupAssistantWorkspace(t);
    const diagramId = await t.run((ctx) => ctx.db.insert("diagrams", { workspaceId, name: "Flow" }));
    const model = installTextModel("I can't read diagrams yet.");

    await summonWith("explain", [
      { type: "resourceReference", props: { resourceId: diagramId, resourceType: "diagram", resourceName: "Flow" } },
    ]);

    expect(prompt(model, 0)).toMatch(/Flow \(diagram .*not readable/s);
    expect((await reply())?.plainText).toBe("I can't read diagrams yet.");
  });

  it("marks a chip to a deleted document as not accessible without failing", async () => {
    const t = createTestContext();
    const { workspaceId, summonWith, reply } = await setupAssistantWorkspace(t);
    const goneId = await insertDocument(t, workspaceId, "Gone", "Old.");
    await t.run((ctx) => ctx.db.delete(goneId));
    const model = installTextModel("That one is gone.");

    await summonWith("summarise", [documentChip(goneId, "Gone")]);

    const first = prompt(model, 0);
    expect(first).toContain(REFUSAL);
    expect(first).not.toContain("Old.");
    expect((await reply())?.plainText).toBe("That one is gone.");
  });

  it("marks a chip the summoner cannot access the same way as deleted", async () => {
    const t = createTestContext();
    const { workspaceId: theirs } = await setupWorkspaceWithAdmin(t, "Theirs");
    const secretId = await insertDocument(t, theirs, "Secret", "Salary bands.");
    const { summonWith } = await setupAssistantWorkspace(t);
    const model = installTextModel("No.");

    await summonWith("summarise", [documentChip(secretId, "Secret")]);

    const first = prompt(model, 0);
    expect(first).toContain(REFUSAL);
    expect(first).not.toContain("Salary bands.");
  });

  it("does not preload a chip from an earlier message", async () => {
    const t = createTestContext();
    const { workspaceId, summon, post } = await setupAssistantWorkspace(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship in Q4.");
    await post(
      chipBody({ resourceId: roadmapId, resourceType: "document", resourceName: "Roadmap" }, "see"),
      "see #Roadmap",
    );
    const model = installTextModel("Maybe.");

    await summon("is that realistic?");

    const first = prompt(model, 0);
    expect(first).not.toContain("Ship in Q4.");
    expect(first).toContain(`#Roadmap (document ${roadmapId})`);
  });

  it("tells the model not to cite what the message itself referenced", async () => {
    const t = createTestContext();
    const { summon } = await setupAssistantWorkspace(t);
    const model = installTextModel("ok");

    await summon("hi");

    expect(prompt(model, 0)).toMatch(/Referenced in the message.*no tool call and no citation/s);
  });
});

describe("read_project", () => {
  it("returns the project's fields and its tasks, open first, capped", async () => {
    const t = createTestContext();
    const { workspaceId, userId, summon } = await setupAssistantWorkspace(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { name: "Billing", key: "BIL", description: "Invoices and dunning." });
      const todo = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const done = await ctx.db.insert("taskStatuses", {
        projectId, name: "Done", color: "bg-green-500", order: 1, isDefault: false, isCompleted: true,
      });
      // One finished task first, so "open first" is an ordering, not insertion order.
      await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Finished early", statusId: done,
        priority: "low", completed: true, creatorId: userId,
      });
      for (let i = 1; i <= 52; i++) {
        await ctx.db.insert("tasks", {
          projectId, workspaceId, title: `Open task ${i}`, statusId: todo,
          priority: "medium", completed: false, creatorId: userId,
        });
      }
    });
    const model = installToolCallingModel("read_project", { projectId }, "Busy.");

    await summon("how is billing going?");

    const second = prompt(model, 1);
    expect(second).toContain("Billing");
    expect(second).toContain("Invoices and dunning.");
    expect(second).toContain("Open task 1");
    expect(second).toContain("Open task 50");
    expect(second).not.toContain("Open task 51");
    expect(second).not.toContain("Finished early");
    expect(second).toMatch(/truncated|more tasks/i);
  });

  it("refuses a project from another workspace", async () => {
    const t = createTestContext();
    const { workspaceId: theirs, userId: theirUser } = await setupWorkspaceWithAdmin(t, "Theirs");
    const projectId = await setupProject(t, { workspaceId: theirs, creatorId: theirUser });
    const { summon } = await setupAssistantWorkspace(t);
    const model = installToolCallingModel("read_project", { projectId }, "No.");

    await summon("read their project");

    expect(prompt(model, 1)).toContain(REFUSAL);
  });
});

describe("a chipped project", () => {
  it("is preloaded with its tasks", async () => {
    const t = createTestContext();
    const { workspaceId, userId, summonWith } = await setupAssistantWorkspace(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { name: "Billing", key: "BIL" });
      const todo = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Send invoices", statusId: todo, number: 7,
        priority: "medium", completed: false, creatorId: userId,
      });
    });
    const model = installTextModel("One task open.");

    await summonWith("status?", [{ type: "projectReference", props: { projectId } }]);

    const first = prompt(model, 0);
    expect(first).toContain(`Billing (project ${projectId})`);
    expect(first).toContain("BIL-7 Send invoices [Todo]");
  });
});

async function insertSpreadsheet(
  t: T,
  workspaceId: Id<"workspaces">,
  name: string,
  rows?: string[][],
  formulaValues?: Record<string, string>,
): Promise<Id<"spreadsheets">> {
  return t.run(async (ctx) => {
    const yjsSnapshotId = rows
      ? await ctx.storage.store(new Blob([gridSnapshot(rows, formulaValues)]))
      : undefined;
    return ctx.db.insert("spreadsheets", { workspaceId, name, yjsSnapshotId });
  });
}

describe("spreadsheets", () => {
  const rows = [["Item", "Total"], ["Widget", "=2*3.5"]];
  const values = { "1,1": "7.00" };

  it("are read by tool as a table of displayed values", async () => {
    const t = createTestContext();
    const { workspaceId, summon } = await setupAssistantWorkspace(t);
    const sheetId = await insertSpreadsheet(t, workspaceId, "Budget", rows, values);
    const model = installToolCallingModel("read_spreadsheet", { spreadsheetId: sheetId }, "7.");

    await summon("what's the total?");

    const second = prompt(model, 1);
    expect(second).toContain("| Widget | 7.00 |");
    expect(second).not.toContain("=2*3.5");
  });

  it("are refused from another workspace", async () => {
    const t = createTestContext();
    const { workspaceId: theirs } = await setupWorkspaceWithAdmin(t, "Theirs");
    const sheetId = await insertSpreadsheet(t, theirs, "Payroll", [["Alice", "9000"]]);
    const { summon } = await setupAssistantWorkspace(t);
    const model = installToolCallingModel("read_spreadsheet", { spreadsheetId: sheetId }, "No.");

    await summon("read payroll");

    const second = prompt(model, 1);
    expect(second).toContain(REFUSAL);
    expect(second).not.toContain("9000");
  });

  it("are preloaded when chipped in the summoning message", async () => {
    const t = createTestContext();
    const { workspaceId, summonWith, reply } = await setupAssistantWorkspace(t);
    const sheetId = await insertSpreadsheet(t, workspaceId, "Budget", rows, values);
    const model = installTextModel("The total is 7.00.");

    await summonWith("total?", [
      { type: "resourceReference", props: { resourceId: sheetId, resourceType: "spreadsheet", resourceName: "Budget" } },
    ]);

    const first = prompt(model, 0);
    expect(first).toContain(`Budget (spreadsheet ${sheetId})`);
    expect(first).toContain("| Widget | 7.00 |");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await reply())?.plainText).toBe("The total is 7.00.");
  });
});

describe("an event chip", () => {
  it("still renders as referenced but not readable", async () => {
    const t = createTestContext();
    const { summonWith } = await setupAssistantWorkspace(t);
    const model = installTextModel("I can't read events yet.");

    await summonWith("when is it?", [{ type: "eventMention", props: { seriesId: "s1" } }]);

    expect(prompt(model, 0)).toMatch(/\(series s1\).*not readable/s);
  });
});
