import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockModel } from "@convex-dev/agent";
import { simulateReadableStream } from "ai";
import type { Id } from "../convex/_generated/dataModel";
import { ChannelRole } from "@ripple/shared/enums/roles";
import { gridSnapshot, paragraphSnapshot } from "./yjsFixtures";
import {
  channelFields,
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The **assistant tools** as the writing assistant exposes them, driven from
 * the top: a scripted model calls a tool on its first step and answers on its
 * second, so what the tool returned is visible in the prompt of the second
 * model call. Nothing here calls a tool or the factory directly.
 *
 * The caller's identity is the **summoner** on this surface. Access cases
 * are therefore expressed as "what this signed-in member can reach".
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

const ORIGIN = "https://ripple.test";
/** The one answer for gone, foreign and denied alike. */
const REFUSAL = "Not found, or you do not have access to it.";
const AI_ENV = ["AZURE_API_KEY", "AZURE_RESOURCE_NAME", "AZURE_OPENAI_DEPLOYMENT"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries([...AI_ENV, "SITE_URL"].map((key) => [key, process.env[key]]));
  for (const key of AI_ENV) process.env[key] = `test-${key}`;
  process.env.SITE_URL = ORIGIN;
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  mocks.model = null;
});

type MockLanguageModel = ReturnType<typeof mockModel> & {
  doStreamCalls: { prompt: unknown }[];
};

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * A model that calls `toolName` with `input` on its first step and answers
 * "done" on its second. The component's mock model streams a V2-shaped
 * finish, which the SDK does not read as "tool calls, continue", so the
 * stream is spelled out here in the provider's current shape.
 */
function installToolCallingModel(toolName: string, input: Record<string, unknown>) {
  const steps: Record<string, unknown>[][] = [
    [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) },
      { type: "finish", finishReason: { unified: "tool-calls" }, usage: USAGE },
    ],
    [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "done" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: { unified: "stop" }, usage: USAGE },
    ],
  ];
  let call = 0;
  mocks.model = mockModel({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: steps[Math.min(call++, steps.length - 1)] }),
      request: { body: {} },
      response: { headers: {} },
    }),
  } as never);
  return mocks.model as MockLanguageModel;
}

/** What the model was shown on its second step: the tool's result, serialised. */
function secondPrompt(model: MockLanguageModel): string {
  expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(2);
  return JSON.stringify(model.doStreamCalls[1].prompt);
}

function requestBody(documentId: string) {
  return JSON.stringify({
    documentId,
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    toolDefinitions: {
      applyDocumentOperations: {
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object" },
      },
    },
  });
}

const post = (body: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN },
  body,
});

type T = ReturnType<typeof createTestContext>;

async function insertDocument(
  t: T,
  workspaceId: Id<"workspaces">,
  name: string,
  snapshotText?: string,
): Promise<Id<"documents">> {
  return t.run(async (ctx) => {
    const yjsSnapshotId = snapshotText
      ? await ctx.storage.store(
          new Blob([paragraphSnapshot(snapshotText)], { type: "application/octet-stream" }),
        )
      : undefined;
    return ctx.db.insert("documents", { workspaceId, name, yjsSnapshotId });
  });
}

/** A member with a document open in the editor, which is what the route gates on. */
async function setupEditor(t: T, workspaceName?: string) {
  const setup = await setupWorkspaceWithAdmin(t, workspaceName);
  const editingId = await insertDocument(t, setup.workspaceId, "Editing");
  const run = async () => {
    const response = await setup.asUser.fetch("/ai/document", post(requestBody(editingId)));
    expect(response.status).toBe(200);
    await response.text();
  };
  return { ...setup, run };
}

describe("read_document", () => {
  it("returns a workspace document's text to the model", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap", "Ship the assistant in Q4.");
    const model = installToolCallingModel("read_document", { documentId: roadmapId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Ship the assistant in Q4.");
    expect(prompt).toContain("Roadmap");
  });

  it("refuses a document from another workspace with the one refusal", async () => {
    const t = createTestContext();
    const { workspaceId: theirs } = await setupWorkspaceWithAdmin(t, "Theirs");
    const secretId = await insertDocument(t, theirs, "Secret", "Salary bands.");
    const { run } = await setupEditor(t, "Mine");
    const model = installToolCallingModel("read_document", { documentId: secretId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain(REFUSAL);
    expect(prompt).not.toContain("Salary bands.");
    expect(prompt).not.toContain("Secret");
  });

  it("reads a document nobody has written into as empty, not as a refusal", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const blankId = await insertDocument(t, workspaceId, "Blank");
    const model = installToolCallingModel("read_document", { documentId: blankId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain('"content":""');
    expect(prompt).not.toContain(REFUSAL);
  });

  it("clips a long document and says so", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const longId = await insertDocument(t, workspaceId, "Long", "x".repeat(70_000));
    const model = installToolCallingModel("read_document", { documentId: longId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("[truncated]");
    expect(prompt.length).toBeLessThan(70_000);
  });
});

describe("read_task", () => {
  it("returns a task's fields and description", async () => {
    const t = createTestContext();
    const { workspaceId, userId, run } = await setupEditor(t);
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
    const model = installToolCallingModel("read_task", { taskId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Key rotation");
    expect(prompt).toContain("In progress");
    expect(prompt).toContain("Rotate the signing key.");
  });
});

describe("read_channel_messages", () => {
  async function channelWithMessage(
    t: T,
    workspaceId: Id<"workspaces">,
    authorId: Id<"users">,
    visibility: "open" | "closed",
    memberIds: Id<"users">[],
  ) {
    return t.run(async (ctx) => {
      const channelId = await ctx.db.insert("channels", {
        name: "planning", workspaceId, ...channelFields(visibility),
      });
      for (const userId of memberIds) {
        await ctx.db.insert("channelMembers", {
          channelId, userId, workspaceId, role: ChannelRole.MEMBER,
        });
      }
      await ctx.db.insert("messages", {
        userId: authorId, channelId, isomorphicId: "m-1", deleted: false,
        body: "[]", plainText: "Launch moved to Friday.",
      });
      return channelId;
    });
  }

  it("reads a public channel's recent messages", async () => {
    const t = createTestContext();
    const { workspaceId, userId, run } = await setupEditor(t);
    const channelId = await channelWithMessage(t, workspaceId, userId, "open", []);
    const model = installToolCallingModel("read_channel_messages", { channelId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Launch moved to Friday.");
    expect(prompt).toContain("planning");
  });

  it("reads a private channel the summoner is in", async () => {
    const t = createTestContext();
    const { workspaceId, userId, run } = await setupEditor(t);
    const channelId = await channelWithMessage(t, workspaceId, userId, "closed", [userId]);
    const model = installToolCallingModel("read_channel_messages", { channelId });

    await run();

    expect(secondPrompt(model)).toContain("Launch moved to Friday.");
  });

  it("refuses a private channel the summoner is not in", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const { userId: insiderId } = await setupWorkspaceWithAdmin(t, "Unused");
    const channelId = await channelWithMessage(t, workspaceId, insiderId, "closed", [insiderId]);
    const model = installToolCallingModel("read_channel_messages", { channelId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain(REFUSAL);
    expect(prompt).not.toContain("Launch moved to Friday.");
  });
});

describe("search_workspace", () => {
  it("finds a resource by name and returns its id", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const roadmapId = await insertDocument(t, workspaceId, "Roadmap 2027");
    await t.run((ctx) =>
      ctx.db.insert("nodes", {
        workspaceId, resourceType: "document", resourceId: roadmapId,
        name: "Roadmap 2027", searchable: true,
      }),
    );
    const model = installToolCallingModel("search_workspace", { query: "roadmap" });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Roadmap 2027");
    expect(prompt).toContain(roadmapId);
  });
});

describe("read_project", () => {
  it("returns a project's fields and tasks on the writing surface too", async () => {
    const t = createTestContext();
    const { workspaceId, userId, run } = await setupEditor(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { name: "Billing", key: "BIL" });
      const todo = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Send invoices", statusId: todo,
        priority: "medium", completed: false, creatorId: userId,
      });
    });
    const model = installToolCallingModel("read_project", { projectId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Billing");
    expect(prompt).toContain("Send invoices");
    expect(prompt).toContain("Todo");
  });
});

describe("read_spreadsheet", () => {
  it("returns a spreadsheet as a table on the writing surface too", async () => {
    const t = createTestContext();
    const { workspaceId, run } = await setupEditor(t);
    const sheetId = await t.run(async (ctx) => {
      const yjsSnapshotId = await ctx.storage.store(
        new Blob([gridSnapshot([["Item", "Qty"], ["Widget", "2"]])]),
      );
      return ctx.db.insert("spreadsheets", { workspaceId, name: "Stock", yjsSnapshotId });
    });
    const model = installToolCallingModel("read_spreadsheet", { spreadsheetId: sheetId });

    await run();

    const prompt = secondPrompt(model);
    expect(prompt).toContain("Stock");
    expect(prompt).toContain("| Widget | 2 |");
  });
});
