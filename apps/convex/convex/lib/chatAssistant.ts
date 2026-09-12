import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * The parts of the workspace assistant that hold no Convex function: its
 * identity row, and the text that goes to the model. Kept apart from
 * `chatAssistant.ts` so the entitlement toggle (which creates the identity)
 * and the reply action (which builds the prompt) can import them without
 * pulling each other in.
 */

/** What the bot user is called. Shown as the author of every reply. */
export const ASSISTANT_NAME = "Assistant";

/**
 * The most channel messages one reply is given as context. The transcript
 * stops earlier when it reaches the assistant's previous reply, because
 * everything before that is already in the thread the agent component keeps.
 */
export const TRANSCRIPT_MAX_MESSAGES = 30;

/** A reply longer than this is not a chat message. */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 4_000;

/**
 * The most model round trips one reply may take. A chat answer that needs
 * more reads than this is the wrong surface for the question; the writing
 * assistant allows more.
 */
export const ASSISTANT_MAX_STEPS = 6;

/** A tool read returns at most this much text to a chat reply. */
export const ASSISTANT_MAX_READ_CHARS = 30_000;

/**
 * The most **reference chips** of a summoning message that are preloaded as
 * **referenced context**. The rest are still in the transcript with their
 * ids, so the model can reach them by tool if it judges them relevant.
 */
export const REFERENCED_CONTEXT_MAX = 5;

/**
 * One chip of the summoning message, loaded. `read` carries the content;
 * `empty` is a resource nobody has written into; `not-readable` is a type
 * this version cannot read (a diagram, an event, a series); and
 * `not-accessible` is gone, foreign or denied — one status, deliberately.
 */
export interface ReferencedContext {
  type: string;
  id: string;
  name: string;
  status: "read" | "empty" | "not-readable" | "not-accessible";
  content?: string;
}

export async function findWorkspaceAssistant(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaceAssistants"> | null> {
  return ctx.db
    .query("workspaceAssistants")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/**
 * Give the workspace its assistant if it has none. Idempotent: the entitlement
 * toggle calls it on every enable, and the bot user must survive a disable so
 * the messages it authored keep their author.
 */
export async function ensureWorkspaceAssistant(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Id<"users">> {
  const existing = await findWorkspaceAssistant(ctx, workspaceId);
  if (existing) return existing.botUserId;

  const botUserId = await ctx.db.insert("users", {
    name: ASSISTANT_NAME,
    isBot: true,
  });
  await ctx.db.insert("workspaceAssistants", { workspaceId, botUserId });
  return botUserId;
}

/** One channel message as the model reads it. */
export type TranscriptEntry = {
  author: string;
  text: string;
  /** Written by the assistant itself. */
  isAssistant: boolean;
  /** The message that mentioned the assistant and is being answered. */
  isTrigger: boolean;
};

export function assistantInstructions(args: {
  assistantName: string;
  workspaceName: string;
  channelName: string;
}): string {
  return [
    `You are ${args.assistantName}, the assistant of the "${args.workspaceName}" workspace in Ripple, a team collaboration app.`,
    `You take part in the chat channel "${args.channelName}". People summon you by mentioning your name; you answer in the channel, where everyone in it can read you.`,
    "Answer the message that mentions you. Use the earlier messages as context, not as questions to answer.",
    "Be brief and direct: a chat reply, not an essay. Do not restate the question or announce what you are about to do.",
    "",
    "You have read-only tools over the workspace, used with the access of the person who mentioned you: search_workspace finds documents, tasks, channels, projects, diagrams and spreadsheets by name and returns their ids; read_document, read_task, read_project, read_spreadsheet and read_channel_messages return their content. A reference in the channel is written as its name followed by its type and id in parentheses; pass that id to the matching read tool.",
    "Use a tool when the question is about something the channel messages do not contain. Never invent what a tool could have told you.",
    "When a tool answers that something was not found or is not accessible, say that you could not find it or cannot access it. Do not guess at its contents and do not speculate about why.",
    "The message that mentions you may reference resources; their content is given to you below the messages, under \"Referenced in the message\". Answer from it directly; it needs no tool call and no citation.",
    "If you read something through a tool, end the reply with one line: \"Sources:\" followed by the names of what you read, comma-separated. Leave that line out when you read nothing through a tool — what the message itself referenced is already in front of the person.",
    "Do not mention tool names to the person.",
    "",
    "Write in the language the person who mentioned you used.",
    "Format with plain markdown. Headings are almost never needed in a chat reply.",
  ].join("\n");
}

/**
 * The user turn for one reply: the channel since the assistant last spoke,
 * oldest first, with the message being answered marked.
 */
export function renderTranscript(entries: TranscriptEntry[]): string {
  const lines = entries.map((entry) => {
    const who = entry.isAssistant ? `${entry.author} (you)` : entry.author;
    const marker = entry.isTrigger ? " [mentions you]" : "";
    return `${who}${marker}: ${entry.text}`;
  });
  return ["New messages in the channel:", "", ...lines].join("\n");
}

/**
 * The referenced context as the model reads it, after the transcript: one
 * section per chip, headed the way the transcript spells the chip, so the
 * two match up. Empty when the message carried no chips.
 */
export function renderReferencedContext(entries: ReferencedContext[]): string {
  if (entries.length === 0) return "";
  const sections = entries.map((entry) => {
    const heading = `### ${entry.name} (${entry.type} ${entry.id})`;
    switch (entry.status) {
      case "read":
        return `${heading}\n${entry.content ?? ""}`;
      case "empty":
        return `${heading}\n[empty — nobody has written into it yet]`;
      case "not-readable":
        return `${heading}\n[referenced, but not readable yet: say so if asked about its contents]`;
      case "not-accessible":
        return `${heading}\n[Not found, or you do not have access to it.]`;
    }
  });
  return ["Referenced in the message that mentions you:", "", ...sections].join("\n\n");
}
