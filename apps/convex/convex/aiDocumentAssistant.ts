import { getAuthUserId } from "@convex-dev/auth/server";
import { convertToModelMessages, type StepResult, type ToolSet } from "ai";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { AiSurface, createAgent, readAiConfig } from "./lib/aiAgents";
import { assistantTools } from "./lib/assistantTools";
import {
  assistantSystemPrompt,
  corsHeaders,
  describeOperations,
  injectDocumentState,
  parseAssistantRequest,
  toolDefinitionsToToolSet,
  type AssistantSurface,
  type AssistantTarget,
} from "./lib/documentAssistant";

/**
 * POST /ai/document — the backend of the in-editor writing assistant, for a
 * document and for a task's description alike.
 *
 * The editor (`@blocknote/xl-ai`) sends the chat so far, the document snapshot
 * and the tool definitions for its own operations; this route runs the model
 * with those tools plus a read-only view of the workspace, and streams the
 * result back as an AI SDK UI message stream. Document operations are never
 * executed here: the tool has no `execute`, so the call ends the model's turn
 * and the editor applies it as a reviewable suggestion.
 *
 * The body names what is being edited (`documentId` or `taskId`), and the
 * public query the editor itself reads through — `documents.get` or
 * `tasks.get`, both the workspace rule — decides whether the caller may work
 * on it. The reading tools are the shared **assistant tools**
 * (`lib/assistantTools`), bound to the caller as **summoner**: the identity is
 * resolved once here and handed to the factory as data, and every read applies
 * its rule through `assistantReads.ts`. Nothing here decides access on its own.
 *
 * The model runs through an `@convex-dev/agent` Agent (`lib/aiAgents`) rather
 * than a bare `streamText`, for the token accounting its usage handler writes.
 * No thread is passed, so the component saves nothing: the editor keeps the
 * chat history itself and resends it whole on every request, and the document
 * snapshots `injectDocumentState` synthesises are meant to be thrown away
 * after the call. The result is still the AI SDK's own `StreamTextResult`, so
 * the response the editor gets is byte-for-byte what it got before.
 */

/** What the assistant is called on the usage rows it produces, per surface. */
const AGENT_NAMES: Record<AssistantTarget["type"], string> = {
  document: "Document assistant",
  task: "Task assistant",
};
/** Reads are cheap; edits are one call. This bounds a model that keeps looking. */
const MAX_STEPS = 8;
/** Enough for a long document rewrite; the stream keeps the request alive. */
const MAX_OUTPUT_TOKENS = 32_000;

/**
 * The server's half of the picture, one line per step. The editor is the only
 * place a document operation is checked, and it does not report back (see
 * `describeOperations`), so a request the editor rejected looks from here like
 * any other: a 200 that streamed to the end. What the route *can* see, and
 * writes down: which blocks each operations call addressed, a tool call the
 * model produced that failed to parse against its own schema (a `tool-error`
 * part — those also cover a workspace read tool that threw), and any turn that
 * ended without a tool call at all — prose in place of operations, a content
 * filter, or a truncation at `MAX_OUTPUT_TOKENS`.
 */
function logStep(step: StepResult<ToolSet>): void {
  for (const part of step.content) {
    if (part.type === "tool-error") {
      console.error("Document assistant: tool call failed", {
        tool: part.toolName,
        error: part.error instanceof Error ? part.error.message : String(part.error),
        input: JSON.stringify(part.input)?.slice(0, 200),
      });
    } else if (part.type === "tool-call" && part.toolName === "applyDocumentOperations") {
      console.log("Document assistant:", describeOperations(part.input));
    }
  }
  if (step.finishReason === "stop" && step.toolCalls.length === 0) {
    console.warn("Document assistant: model answered in prose, no operations", {
      textLength: step.text.length,
    });
  } else if (step.finishReason !== "stop" && step.finishReason !== "tool-calls") {
    console.warn("Document assistant: abnormal finish", { finishReason: step.finishReason });
  }
}
/** A read tool returns at most this much text; the model does not need more. */
const MAX_READ_CHARS = 60_000;

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * A malformed id fails validation inside `runQuery`; for the route's own gate
 * that is the same answer as no access.
 */
async function orNull<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/** What the route learns about its target once access is granted. */
interface ResolvedTarget {
  workspaceId: Id<"workspaces">;
  aiSurface: AiSurface;
  surface: AssistantSurface;
}

/**
 * The workspace rule, applied by the query the editor itself reads through —
 * the same gate a person passes to open the thing. Null is "no access", and
 * a malformed id (which fails validation inside `runQuery`) is the same
 * answer.
 */
async function resolveTarget(
  ctx: ActionCtx,
  target: AssistantTarget,
): Promise<ResolvedTarget | null> {
  switch (target.type) {
    case "document": {
      const document = await orNull(() =>
        ctx.runQuery(api.documents.get, { id: target.id as Id<"documents"> }),
      );
      if (!document) return null;
      return {
        workspaceId: document.workspaceId,
        aiSurface: AiSurface.DOCUMENT_ASSISTANT,
        surface: { type: "document" },
      };
    }
    case "task": {
      const task = await orNull(() =>
        ctx.runQuery(api.tasks.get, { taskId: target.id as Id<"tasks"> }),
      );
      if (!task) return null;
      return {
        workspaceId: task.workspaceId,
        aiSurface: AiSurface.TASK_ASSISTANT,
        surface: {
          type: "task",
          title: task.title,
          number: task.number,
          projectKey: task.projectKey,
        },
      };
    }
  }
}

export const documentAssistantPreflight = httpAction(async (_ctx, request) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin"), process.env.SITE_URL),
  });
});

export const documentAssistant = httpAction(async (ctx, request) => {
  const cors = corsHeaders(request.headers.get("Origin"), process.env.SITE_URL);

  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return jsonResponse({ error: "Not authenticated" }, 401, cors);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400, cors);
  }
  const parsed = parseAssistantRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, cors);
  }
  const { target, messages, toolDefinitions } = parsed.value;

  const resolved = await resolveTarget(ctx, target);
  if (!resolved) {
    return jsonResponse({ error: `You do not have access to this ${target.type}` }, 403, cors);
  }

  const config = readAiConfig();
  if (!config) {
    return jsonResponse({ error: "The AI assistant is not configured" }, 503, cors);
  }

  const agent = createAgent({
    surface: resolved.aiSurface,
    workspaceId: resolved.workspaceId,
    config,
    name: AGENT_NAMES[target.type],
    instructions: assistantSystemPrompt(resolved.surface),
    maxSteps: MAX_STEPS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const result = await agent.streamText(
    ctx,
    // No thread: the editor owns the history. `userId` is passed anyway so the
    // usage rows attribute to whoever asked.
    { userId },
    {
      messages: await convertToModelMessages(injectDocumentState(messages)),
      tools: {
        ...toolDefinitionsToToolSet(toolDefinitions),
        ...assistantTools(ctx, {
          workspaceId: resolved.workspaceId,
          userId,
          maxReadChars: MAX_READ_CHARS,
        }),
      },
      toolChoice: "auto",
      abortSignal: request.signal,
      onStepFinish: logStep,
    },
    {
      // Belt and braces with the missing thread: neither read history back nor
      // write any. `recentMessages` defaults to 100, and the editor has already
      // sent everything the model should see.
      contextOptions: { recentMessages: 0 },
      storageOptions: { saveMessages: "none" },
      // The editor reads this stream over HTTP, not through a Convex query
      // subscription, so persisted deltas would be writes nobody reads.
      saveStreamDeltas: false,
    },
  );

  return result.toUIMessageStreamResponse({
    headers: cors,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
});
