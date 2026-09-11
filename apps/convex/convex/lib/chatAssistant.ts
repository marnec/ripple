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
    "You can only see this channel's messages. If you are asked about something they do not contain, say so rather than guessing.",
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
