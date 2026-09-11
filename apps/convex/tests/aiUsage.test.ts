import { describe, expect, it, vi } from "vitest";
import type { LanguageModelUsage } from "ai";
import { api, internal } from "../convex/_generated/api";
import { AiSurface, recordUsage } from "../convex/lib/aiAgents";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * The usage handler every agent carries (`lib/aiAgents.ts`) is the only
 * metering the document assistant has — that route is an HTTP action, so it
 * passes through neither `aiPool` nor the `assistantReply` rate limit. It is
 * exercised here directly rather than through a model call: the handler is
 * handed the AI SDK's usage object by the agent component, so a fake one is
 * the same input the real path produces, without a provider round trip.
 */

type T = ReturnType<typeof createTestContext>;

/**
 * The component calls the handler with its own action ctx; `runMutation` is
 * the only part of it the handler touches.
 */
function usageCtx(t: T) {
  return {
    runMutation: (reference: unknown, args: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      t.mutation(reference as any, args as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** What the AI SDK hands back after a call, with the details Anthropic fills in. */
function usage(overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 1_200,
    inputTokenDetails: {
      noCacheTokens: 200,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    },
    outputTokens: 350,
    outputTokenDetails: { textTokens: 300, reasoningTokens: 50 },
    totalTokens: 1_550,
    ...overrides,
  };
}

const rows = (t: T) => t.run((ctx) => ctx.db.query("aiUsage").collect());

async function platformAdmin(t: T) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email: "admin@example.com",
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { asAdmin: asUser };
}

describe("AI usage accounting", () => {
  it("records one row per call, attributed to the workspace, user and surface", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    await recordUsage(AiSurface.DOCUMENT_ASSISTANT, workspaceId)(usageCtx(t), {
      userId,
      threadId: undefined,
      agentName: "Document assistant",
      model: "claude-opus-5",
      provider: "azure",
      usage: usage(),
      providerMetadata: undefined,
    });

    const [row] = await rows(t);
    expect(row).toMatchObject({
      workspaceId,
      userId,
      surface: AiSurface.DOCUMENT_ASSISTANT,
      provider: "azure",
      model: "claude-opus-5",
      inputTokens: 1_200,
      outputTokens: 350,
      totalTokens: 1_550,
    });
  });

  /**
   * Cache reads and writes are priced differently from plain input tokens, and
   * the AI SDK moved them into `inputTokenDetails` — reading the deprecated
   * flat fields instead would silently record nothing for either.
   */
  it("keeps cache reads, cache writes and reasoning tokens as their own columns", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    await recordUsage(AiSurface.CHAT_ASSISTANT, workspaceId)(usageCtx(t), {
      userId,
      threadId: "thread-1",
      agentName: "Assistant",
      model: "claude-opus-5",
      provider: "azure",
      usage: usage(),
      providerMetadata: undefined,
    });

    const [row] = await rows(t);
    expect(row).toMatchObject({
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
      reasoningTokens: 50,
    });
  });

  /** A provider that reports no counts must still leave a row, not a crash. */
  it("stores zeroes when the provider reported no token counts", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    await recordUsage(AiSurface.CHAT_ASSISTANT, workspaceId)(usageCtx(t), {
      userId,
      threadId: undefined,
      agentName: "Assistant",
      model: "claude-opus-5",
      provider: "azure",
      usage: usage({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      }),
      providerMetadata: undefined,
    });

    const [row] = await rows(t);
    expect(row).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  /**
   * The document assistant runs this inside `onStepFinish`, while the response
   * is still streaming to the editor. A failed write is a lost row; a thrown
   * one is a broken stream the user is watching.
   */
  it("swallows a failed write rather than breaking the generation", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const failing = {
      runMutation: () => Promise.reject(new Error("write failed")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      recordUsage(AiSurface.DOCUMENT_ASSISTANT, workspaceId)(failing, {
        userId,
        threadId: undefined,
        agentName: "Document assistant",
        model: "claude-opus-5",
        provider: "azure",
        usage: usage(),
        providerMetadata: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  /** Usage rows are workspace children; a deleted workspace must not leave any. */
  it("is swept away with the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    await t.mutation(internal.aiUsage.record, {
      workspaceId,
      userId,
      surface: AiSurface.DOCUMENT_ASSISTANT,
      provider: "azure",
      model: "claude-opus-5",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(await rows(t)).toHaveLength(1);

    const { asAdmin } = await platformAdmin(t);
    await asAdmin.mutation(api.admin.workspaces.remove, { workspaceId });
    await t.finishInProgressScheduledFunctions();

    expect(await rows(t)).toHaveLength(0);
  });
});
