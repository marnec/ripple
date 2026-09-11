import { jsonSchema, tool, type JSONSchema7, type ToolSet, type UIMessage } from "ai";
import * as Y from "yjs";
import { DOCUMENT_FRAGMENT, extractTextFromXml } from "@ripple/shared/blockRef";

/**
 * The document assistant's request/response plumbing, kept free of Convex
 * imports so the HTTP route (default runtime) can use it and the tests can
 * exercise it without a deployment.
 *
 * The wire contract is BlockNote's: `@blocknote/xl-ai` drives the editor and
 * posts an AI SDK chat request whose body carries the `toolDefinitions` the
 * editor wants the model to call (add / update / delete HTML blocks, bundled
 * into one `applyDocumentOperations` tool) and, on every user message, a
 * `documentState` snapshot in the message metadata. The server's job is to run
 * the model with those tools exposed and stream the tool calls back; the
 * editor applies them itself, as reviewable suggestions.
 *
 * BlockNote ships server helpers for this (`@blocknote/xl-ai/server`) but that
 * entry pulls `@blocknote/core` and ProseMirror into whatever bundles it, and
 * an HTTP action is a default-runtime function with no Node escape hatch. The
 * pieces we need are small, so they live here instead. The shapes mirror the
 * upstream ones on purpose: the client is the same package either way.
 */

// ── Request ──────────────────────────────────────────────────────────────────

/** A serialisable tool, the way the editor sends it. */
export interface ToolDefinition {
  description?: string;
  inputSchema: JSONSchema7;
  outputSchema?: JSONSchema7;
}

export interface AssistantRequest {
  documentId: string;
  messages: UIMessage[];
  toolDefinitions: Record<string, ToolDefinition>;
}

export type ParsedAssistantRequest =
  | { ok: true; value: AssistantRequest }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrow an untrusted JSON body to the request the route handles. Everything
 * the model will see passes through here, so a body that fails is a 400, not a
 * guess.
 */
export function parseAssistantRequest(body: unknown): ParsedAssistantRequest {
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };

  const { documentId, messages, toolDefinitions } = body;
  if (typeof documentId !== "string" || documentId.length === 0) {
    return { ok: false, error: "documentId must be a non-empty string" };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  for (const message of messages) {
    if (
      !isRecord(message) ||
      typeof message.role !== "string" ||
      typeof message.id !== "string" ||
      !Array.isArray(message.parts)
    ) {
      return { ok: false, error: "Every message needs an id, a role and parts" };
    }
  }
  if (!isRecord(toolDefinitions)) {
    return { ok: false, error: "toolDefinitions must be an object" };
  }
  for (const [name, definition] of Object.entries(toolDefinitions)) {
    if (!isRecord(definition) || !isRecord(definition.inputSchema)) {
      return { ok: false, error: `Tool "${name}" is missing its inputSchema` };
    }
  }

  return {
    ok: true,
    value: {
      documentId,
      messages: messages as UIMessage[],
      toolDefinitions: toolDefinitions as Record<string, ToolDefinition>,
    },
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

/**
 * Turn the editor's tool definitions into AI SDK tools **without** `execute`:
 * a call to one of these ends the model's turn and travels back to the editor,
 * which is the only place it can be applied.
 */
export function toolDefinitionsToToolSet(
  toolDefinitions: Record<string, ToolDefinition>,
): ToolSet {
  return Object.fromEntries(
    Object.entries(toolDefinitions).map(([name, definition]) => [
      name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema),
        ...(definition.outputSchema
          ? { outputSchema: jsonSchema(definition.outputSchema) }
          : {}),
      }),
    ]),
  );
}

/**
 * A content-free, one-line account of an `applyDocumentOperations` call, for
 * the route's logs.
 *
 * The editor validates every operation it receives — an id that is not in the
 * document, a missing `$` suffix, a block it cannot parse — and rejects the
 * whole call on the first bad one. That verdict never reaches the server: the
 * tool has no `execute`, so from here the request was a 200 that streamed
 * fine. Logging which blocks the model addressed (never their content, which
 * is the user's document) is what lets a rejection in the editor be matched
 * to the request that produced it.
 */
export function describeOperations(input: unknown): string {
  if (!isRecord(input) || !Array.isArray(input.operations)) {
    return "no operations array";
  }
  const asId = (value: unknown) => (typeof value === "string" ? value : "?");
  const described = input.operations.map((operation) => {
    if (!isRecord(operation)) return "malformed";
    switch (operation.type) {
      case "add": {
        const blocks = Array.isArray(operation.blocks) ? operation.blocks.length : 0;
        return `add ${asId(operation.position)} ${asId(operation.referenceId)} (${blocks} blocks)`;
      }
      case "update":
        return `update ${asId(operation.id)}`;
      case "delete":
        return `delete ${asId(operation.id)}`;
      default:
        return `unknown type ${JSON.stringify(operation.type)}`;
    }
  });
  return `${described.length} operations: ${described.join(", ")}`;
}

// ── Document state ───────────────────────────────────────────────────────────

/** The snapshot the editor attaches to each user message it sends. */
interface DocumentState {
  selection: boolean;
  blocks: unknown[];
  selectedBlocks?: unknown[];
  isEmptyDocument: boolean;
}

function documentStateOf(message: UIMessage): DocumentState | null {
  if (message.role !== "user" || !isRecord(message.metadata)) return null;
  const state = message.metadata.documentState;
  if (!isRecord(state) || !Array.isArray(state.blocks)) return null;
  return state as unknown as DocumentState;
}

/**
 * Expand the document state riding on each user message into an assistant
 * message the model reads right before it. The editor keeps the snapshot in
 * metadata (so the chat history stays small and the latest state always wins);
 * the model needs it as plain content.
 */
export function injectDocumentState(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    const state = documentStateOf(message);
    if (!state) return [message];

    const parts = state.selection
      ? [
          {
            type: "text" as const,
            text: "This is the current selection. Ignore earlier selections and issue operations against these blocks only:",
          },
          { type: "text" as const, text: JSON.stringify(state.selectedBlocks ?? []) },
          {
            type: "text" as const,
            text: "This is the current state of the whole document, selection included. Use it for context only; operations must target the selection above:",
          },
          { type: "text" as const, text: JSON.stringify(state.blocks) },
        ]
      : [
          {
            type: "text" as const,
            text:
              "There is no active selection. This is the current state of the document; ignore earlier versions and issue operations against this one. " +
              "The cursor sits between two blocks, marked with cursor: true. " +
              (state.isEmptyDocument
                ? "The document is empty, so update the empty block first before adding new ones."
                : "Prefer updating existing blocks over deleting and re-adding them, unless the request calls for it."),
          },
          { type: "text" as const, text: JSON.stringify(state.blocks) },
        ];

    return [
      { role: "assistant" as const, id: `document-state-${message.id}`, parts },
      message,
    ];
  });
}

// ── System prompt ────────────────────────────────────────────────────────────

/**
 * What the editor's operations expect, plus how to use the workspace tools.
 * The block rules are the contract of BlockNote's HTML operations: ids are
 * echoed back verbatim (they carry a trailing `$`), list items are one block
 * each, and code blocks name their language on the `<code>` tag.
 */
export const DOCUMENT_ASSISTANT_SYSTEM_PROMPT = `You are the writing assistant inside a collaborative document editor. You change the document by calling the applyDocumentOperations tool with add, update and delete operations on HTML blocks.

Rules for operations:
- Block ids MUST be repeated exactly as given, including the trailing $.
- A list is one block per item: <ul><li>item</li></ul> is one block; several <li> in one block is invalid. Consecutive list blocks are merged automatically.
- Code blocks are <pre><code data-language="...">...</code></pre>.
- When there is no selection, work out which part of the document the user means. Take the cursor into account: "below" usually means the blocks after the cursor. To insert at the cursor, use referenceId pointing at the block before the cursor with position "after".
- Keep the user's voice and formatting unless asked to change them.

You also have read-only tools for the rest of the workspace: search_workspace finds documents, tasks, channels, projects, diagrams and spreadsheets by name; read_document, read_task and read_channel_messages return their content. Use them when the request refers to something outside this document, or when the document would benefit from facts you can look up. Never invent content that a tool could have provided. Do not mention tool names to the user.

Every response must end with a single applyDocumentOperations call that carries every operation. Never answer with prose alone.`;

// ── CORS ─────────────────────────────────────────────────────────────────────

/**
 * The route is called cross-origin by the web app. Only the configured site
 * may call it; any other origin gets no allow header and the browser blocks
 * the read. `Vary: Origin` keeps a cache from replaying one origin's answer to
 * another.
 */
export function corsHeaders(
  requestOrigin: string | null,
  allowedOrigin: string | undefined,
): Record<string, string> {
  if (!allowedOrigin || requestOrigin !== allowedOrigin) {
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ── Snapshot reading ─────────────────────────────────────────────────────────

interface XmlNode {
  nodeName?: string;
  getAttribute?(name: string): string | undefined;
  toArray(): Array<unknown>;
  toString(): string;
}

function linePrefix(type: string, element: XmlNode, ordinal: number): string {
  switch (type) {
    case "heading": {
      const level = parseInt(element.getAttribute?.("level") ?? "1", 10);
      return "#".repeat(Number.isFinite(level) && level > 0 ? level : 1) + " ";
    }
    case "bulletListItem":
      return "- ";
    case "numberedListItem":
      return `${ordinal}. `;
    case "checkListItem":
      return element.getAttribute?.("checked") === "true" ? "- [x] " : "- [ ] ";
    case "quote":
      return "> ";
    default:
      return "";
  }
}

function walkBlockGroup(group: XmlNode, depth: number, out: string[]): void {
  let ordinal = 0;
  for (const child of group.toArray()) {
    const container = child as XmlNode;
    if (container.nodeName !== "blockContainer") continue;
    const children = container.toArray();
    const content = children[0] as XmlNode | undefined;
    if (!content?.nodeName) continue;

    const type = content.nodeName;
    ordinal = type === "numberedListItem" ? ordinal + 1 : 0;
    const indent = "  ".repeat(depth);
    const text = extractTextFromXml(content).trim();

    if (type === "codeBlock") {
      const language = content.getAttribute?.("language") ?? "";
      out.push(`${indent}\`\`\`${language}`, text, `${indent}\`\`\``);
    } else if (text) {
      out.push(indent + linePrefix(type, content, ordinal) + text);
    } else if (!["paragraph", "blockGroup"].includes(type)) {
      // A block with no text of its own (diagram, embed, table…): say what it
      // is rather than dropping it silently.
      out.push(`${indent}[${type}]`);
    }

    const nested = children[1] as XmlNode | undefined;
    if (nested?.nodeName === "blockGroup") walkBlockGroup(nested, depth + 1, out);
  }
}

/**
 * Render a stored Yjs snapshot as plain text with light markdown structure,
 * for the model to read. Works on the raw XML the editor writes, so it needs
 * neither a DOM nor a BlockNote schema, and custom blocks degrade to a marker
 * instead of failing.
 */
export function yjsSnapshotToText(snapshot: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
  const lines: string[] = [];
  for (const top of fragment.toArray()) {
    const group = top as XmlNode;
    if (group.nodeName === "blockGroup") walkBlockGroup(group, 0, lines);
  }
  doc.destroy();
  return lines.join("\n");
}
