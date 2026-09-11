import { getAuthUserId } from "@convex-dev/auth/server";
import { convertToModelMessages, tool, type StepResult, type ToolSet } from "ai";
import { z } from "zod";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { AiSurface, createAgent, readAiConfig } from "./lib/aiAgents";
import {
  corsHeaders,
  describeOperations,
  DOCUMENT_ASSISTANT_SYSTEM_PROMPT,
  injectDocumentState,
  parseAssistantRequest,
  toolDefinitionsToToolSet,
  yjsSnapshotToText,
} from "./lib/documentAssistant";

/**
 * POST /ai/document — the backend of the in-editor document assistant.
 *
 * The editor (`@blocknote/xl-ai`) sends the chat so far, the document snapshot
 * and the tool definitions for its own operations; this route runs the model
 * with those tools plus a read-only view of the workspace, and streams the
 * result back as an AI SDK UI message stream. Document operations are never
 * executed here: the tool has no `execute`, so the call ends the model's turn
 * and the editor applies it as a reviewable suggestion.
 *
 * Access goes through the same public queries the UI uses. `documents.get`
 * decides whether the caller may work on this document, and every reading
 * tool calls a public query that enforces its own rule — the workspace rule
 * for documents and tasks, the channel rule for messages — with the caller's
 * identity, which `runQuery` carries from an HTTP action. Nothing here decides
 * access on its own.
 *
 * The model runs through an `@convex-dev/agent` Agent (`lib/aiAgents`) rather
 * than a bare `streamText`, for the token accounting its usage handler writes.
 * No thread is passed, so the component saves nothing: the editor keeps the
 * chat history itself and resends it whole on every request, and the document
 * snapshots `injectDocumentState` synthesises are meant to be thrown away
 * after the call. The result is still the AI SDK's own `StreamTextResult`, so
 * the response the editor gets is byte-for-byte what it got before.
 */

/** What the assistant is called on the usage rows it produces. */
const AGENT_NAME = "Document assistant";
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

const SEARCHABLE_TYPES = [
  "document",
  "diagram",
  "spreadsheet",
  "project",
  "channel",
  "task",
] as const;

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
 * A query that throws on bad input (an id the model made up, a channel the
 * caller may not read) is a tool result, not a failed stream. Nulling the
 * failure lets the tool report "not found or not accessible" and the model
 * carry on.
 */
async function orNull<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

function clip(text: string): string {
  return text.length > MAX_READ_CHARS
    ? text.slice(0, MAX_READ_CHARS) + "\n[truncated]"
    : text;
}

/**
 * The body of a collaborative resource, read from its stored snapshot. The
 * snapshot lags the live room by the save debounce, which is fine for a read
 * the model uses as context. The URL query applies the workspace rule.
 */
async function readSnapshotText(
  ctx: ActionCtx,
  resourceType: "doc" | "task",
  resourceId: string,
): Promise<string> {
  const url = await ctx.runQuery(api.snapshots.getSnapshotUrl, {
    resourceType,
    resourceId,
  });
  if (!url) return "";
  const response = await fetch(url);
  if (!response.ok) return "";
  return clip(yjsSnapshotToText(new Uint8Array(await response.arrayBuffer())));
}

const NOT_ACCESSIBLE = { error: "Not found, or you do not have access to it." };

/** Read-only tools over the workspace, each bound to the caller's identity. */
function workspaceTools(ctx: ActionCtx, workspaceId: Id<"workspaces">): ToolSet {
  return {
    search_workspace: tool({
      description:
        "Find documents, tasks, channels, projects, diagrams and spreadsheets in this workspace by name. Returns ids for the read tools.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Words from the resource's name"),
        resourceType: z
          .enum(SEARCHABLE_TYPES)
          .optional()
          .describe("Restrict to one kind of resource"),
      }),
      execute: async ({ query, resourceType }) =>
        ctx.runQuery(api.nodes.search, {
          workspaceId,
          searchText: query,
          resourceType,
        }),
    }),

    read_document: tool({
      description:
        "Read another document in the workspace as text with light markdown structure.",
      inputSchema: z.object({
        documentId: z.string().describe("A document id from search_workspace"),
      }),
      execute: async ({ documentId }) => {
        const document = await orNull(() =>
          ctx.runQuery(api.documents.get, { id: documentId as Id<"documents"> }),
        );
        if (!document) return NOT_ACCESSIBLE;
        return {
          name: document.name,
          tags: document.tags ?? [],
          content: await readSnapshotText(ctx, "doc", document._id),
        };
      },
    }),

    read_task: tool({
      description: "Read a task: title, status, assignee, dates and description.",
      inputSchema: z.object({
        taskId: z.string().describe("A task id from search_workspace"),
      }),
      execute: async ({ taskId }) => {
        const task = await orNull(() =>
          ctx.runQuery(api.tasks.get, { taskId: taskId as Id<"tasks"> }),
        );
        if (!task) return NOT_ACCESSIBLE;
        return {
          title: task.title,
          number: task.number ?? null,
          projectKey: task.projectKey ?? null,
          status: task.status?.name ?? null,
          completed: task.completed,
          priority: task.priority,
          assignee: task.assignee?.name ?? null,
          dueDate: task.dueDate ?? null,
          tags: task.tags ?? [],
          description: await readSnapshotText(ctx, "task", task._id),
        };
      },
    }),

    read_channel_messages: tool({
      description:
        "Read the most recent messages of a chat channel, oldest first. Only channels the user can read.",
      inputSchema: z.object({
        channelId: z.string().describe("A channel id from search_workspace"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many recent messages to read (default 30)"),
      }),
      execute: async ({ channelId, limit }) => {
        const id = channelId as Id<"channels">;
        const channel = await orNull(() => ctx.runQuery(api.channels.get, { id }));
        if (!channel) return NOT_ACCESSIBLE;
        // `messages.list` applies the channel rule itself: a closed channel or a
        // DM the caller is not in throws, and that lands here as not accessible.
        const page = await orNull(() =>
          ctx.runQuery(api.messages.list, {
            channelId: id,
            paginationOpts: { numItems: limit ?? 30, cursor: null },
          }),
        );
        if (!page) return NOT_ACCESSIBLE;
        return {
          channel: channel.name,
          messages: page.page
            .slice()
            .reverse()
            .map((message) => ({
              author: message.author,
              at: new Date(message._creationTime).toISOString(),
              text: message.plainText,
            })),
        };
      },
    }),
  };
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
  const { documentId, messages, toolDefinitions } = parsed.value;

  // The workspace rule, applied by the query the editor itself reads through.
  // A malformed id fails validation inside runQuery; treat that as no access.
  const document = await orNull(() =>
    ctx.runQuery(api.documents.get, { id: documentId as Id<"documents"> }),
  );
  if (!document) {
    return jsonResponse({ error: "You do not have access to this document" }, 403, cors);
  }

  const config = readAiConfig();
  if (!config) {
    return jsonResponse({ error: "The AI assistant is not configured" }, 503, cors);
  }

  const agent = createAgent({
    surface: AiSurface.DOCUMENT_ASSISTANT,
    workspaceId: document.workspaceId,
    config,
    name: AGENT_NAME,
    instructions: DOCUMENT_ASSISTANT_SYSTEM_PROMPT,
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
        ...workspaceTools(ctx, document.workspaceId),
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
