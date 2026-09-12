import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ReferencedContext } from "./chatAssistant";
import { yjsSnapshotToText } from "./documentAssistant";
import { spreadsheetSnapshotToText } from "./spreadsheetText";
import type { ReferenceChip } from "../utils/blocknote";

/**
 * The **assistant tools**: the one read-only tool set both assistant surfaces
 * share, bound to a **summoner** (CONTEXT.md, ADR 0003).
 *
 * Built per call with the workspace and the summoner's user id, because the
 * identity is data here, not auth: the writing assistant resolves its caller
 * from the HTTP request and passes it; the chat reply carries the summoner
 * into a workpool action that has no identity of its own. Every read goes
 * through `assistantReads.ts`, whose queries take that user id and apply the
 * same rule the public queries apply — a guard test pins that this module
 * reaches data through nothing else.
 *
 * No Convex function lives here and nothing in it needs Node, so both the
 * HTTP action (default runtime) and the chat action (`"use node"`) import it.
 */

export interface AssistantToolsOptions {
  workspaceId: Id<"workspaces">;
  /** Whose access every read is made with. */
  userId: Id<"users">;
  /** A read returns at most this much text; the surface decides how much. */
  maxReadChars: number;
}

/**
 * One answer for a missing, deleted, foreign or denied resource. Existence is
 * information too, and a chat reply is public to its channel.
 */
export const NOT_ACCESSIBLE = { error: "Not found, or you do not have access to it." };

export const SEARCHABLE_TYPES = [
  "document",
  "diagram",
  "spreadsheet",
  "project",
  "channel",
  "task",
] as const;

/** The most rows a spreadsheet read renders; the rest is a count. */
export const SPREADSHEET_MAX_ROWS = 200;

/** Marks a read that was cut at `maxReadChars`. */
export const TRUNCATED_MARKER = "\n[truncated]";

export function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + TRUNCATED_MARKER : text;
}

/**
 * The body of a collaborative resource, read from its stored snapshot as the
 * summoner. The snapshot lags the live room by the save debounce, which is
 * fine for a read the model uses as context. A resource nobody has written
 * into reads as empty text; one the summoner may not have reads as empty
 * too, but the caller has already been refused by then and never gets here.
 */
async function readSnapshotText(
  ctx: ActionCtx,
  options: AssistantToolsOptions,
  resourceType: "doc" | "task" | "spreadsheet",
  resourceId: string,
): Promise<string> {
  const stored = await ctx.runQuery(internal.assistantReads.getSnapshot, {
    userId: options.userId,
    resourceType,
    resourceId,
  });
  if (stored.status !== "stored") return "";
  const blob = await ctx.storage.get(stored.storageId);
  if (!blob) return "";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text =
    resourceType === "spreadsheet"
      ? spreadsheetSnapshotToText(bytes, { maxRows: SPREADSHEET_MAX_ROWS })
      : yjsSnapshotToText(bytes);
  return clip(text, options.maxReadChars);
}

/** A spreadsheet as a tool returns it, or null when the summoner may not have it. */
async function readSpreadsheet(ctx: ActionCtx, options: AssistantToolsOptions, spreadsheetId: string) {
  const sheet = await ctx.runQuery(internal.assistantReads.getSpreadsheet, {
    userId: options.userId,
    spreadsheetId,
  });
  if (!sheet) return null;
  return {
    name: sheet.name,
    tags: sheet.tags ?? [],
    content: await readSnapshotText(ctx, options, "spreadsheet", sheet._id),
  };
}

/** A document as a tool returns it, or null when the summoner may not have it. */
async function readDocument(ctx: ActionCtx, options: AssistantToolsOptions, documentId: string) {
  const document = await ctx.runQuery(internal.assistantReads.getDocument, {
    userId: options.userId,
    documentId,
  });
  if (!document) return null;
  return {
    name: document.name,
    tags: document.tags ?? [],
    content: await readSnapshotText(ctx, options, "doc", document._id),
  };
}

/** A task as a tool returns it, or null when the summoner may not have it. */
async function readTask(ctx: ActionCtx, options: AssistantToolsOptions, taskId: string) {
  const task = await ctx.runQuery(internal.assistantReads.getTask, {
    userId: options.userId,
    taskId,
  });
  if (!task) return null;
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
    description: await readSnapshotText(ctx, options, "task", task._id),
  };
}

/** A project as a tool returns it, or null when the summoner may not have it. */
async function readProject(ctx: ActionCtx, options: AssistantToolsOptions, projectId: string) {
  const read = await ctx.runQuery(internal.assistantReads.getProject, {
    userId: options.userId,
    projectId,
  });
  if (!read) return null;
  return {
    name: read.project.name,
    key: read.project.key ?? null,
    description: read.project.description ?? "",
    tasks: read.tasks,
    ...(read.omitted > 0
      ? { note: `Task list truncated: ${read.omitted} more tasks not shown, open tasks listed first.` }
      : {}),
  };
}

/** A project's tasks as lines, for the referenced-context block. */
function describeProject(project: NonNullable<Awaited<ReturnType<typeof readProject>>>): string {
  const head = [project.key ? `Key: ${project.key}` : "", project.description].filter(Boolean);
  const tasks = project.tasks.map((task) => {
    const ref = task.number != null && project.key ? `${project.key}-${task.number} ` : "";
    return `- ${ref}${task.title} [${task.status ?? "no status"}${task.completed ? ", completed" : ""}]`;
  });
  return [...head, "", "Tasks:", ...tasks, project.note ?? ""].join("\n").trim();
}

/** A task's fields as prose, for the referenced-context block. */
function describeTask(task: NonNullable<Awaited<ReturnType<typeof readTask>>>): string {
  const lines = [
    `Status: ${task.status ?? "none"}${task.completed ? " (completed)" : ""}`,
    `Priority: ${task.priority}`,
    `Assignee: ${task.assignee ?? "unassigned"}`,
  ];
  if (task.dueDate) lines.push(`Due: ${task.dueDate}`);
  if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(", ")}`);
  return [...lines, "", task.description].join("\n").trim();
}

/**
 * Load the **reference chips** of a summoning message as **referenced
 * context**, each read as the summoner through the same reads the tools
 * use. The caller caps the list; this loads what it is given, in order.
 */
export async function preloadReferences(
  ctx: ActionCtx,
  options: AssistantToolsOptions,
  chips: ReferenceChip[],
): Promise<ReferencedContext[]> {
  const entries: ReferencedContext[] = [];
  for (const chip of chips) {
    const base = { type: chip.type, id: chip.id, name: chip.name ?? chip.type };
    switch (chip.type) {
      case "document": {
        const document = await readDocument(ctx, options, chip.id);
        if (!document) entries.push({ ...base, status: "not-accessible" });
        else if (document.content.length === 0)
          entries.push({ ...base, name: document.name, status: "empty" });
        else entries.push({ ...base, name: document.name, status: "read", content: document.content });
        break;
      }
      case "task": {
        const task = await readTask(ctx, options, chip.id);
        if (!task) entries.push({ ...base, status: "not-accessible" });
        else entries.push({ ...base, name: task.title, status: "read", content: describeTask(task) });
        break;
      }
      case "spreadsheet": {
        const sheet = await readSpreadsheet(ctx, options, chip.id);
        if (!sheet) entries.push({ ...base, status: "not-accessible" });
        else if (sheet.content.length === 0) entries.push({ ...base, name: sheet.name, status: "empty" });
        else entries.push({ ...base, name: sheet.name, status: "read", content: sheet.content });
        break;
      }
      case "project": {
        const project = await readProject(ctx, options, chip.id);
        if (!project) entries.push({ ...base, status: "not-accessible" });
        else entries.push({ ...base, name: project.name, status: "read", content: describeProject(project) });
        break;
      }
      default:
        entries.push({ ...base, status: "not-readable" });
    }
  }
  return entries;
}

export function assistantTools(ctx: ActionCtx, options: AssistantToolsOptions): ToolSet {
  const { workspaceId, userId } = options;
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
        ctx.runQuery(internal.assistantReads.search, {
          userId,
          workspaceId,
          searchText: query,
          resourceType,
        }),
    }),

    read_document: tool({
      description:
        "Read a document in the workspace as text with light markdown structure.",
      inputSchema: z.object({
        documentId: z.string().describe("A document id from search_workspace"),
      }),
      execute: async ({ documentId }) =>
        (await readDocument(ctx, options, documentId)) ?? NOT_ACCESSIBLE,
    }),

    read_task: tool({
      description: "Read a task: title, status, assignee, dates and description.",
      inputSchema: z.object({
        taskId: z.string().describe("A task id from search_workspace"),
      }),
      execute: async ({ taskId }) => (await readTask(ctx, options, taskId)) ?? NOT_ACCESSIBLE,
    }),

    read_spreadsheet: tool({
      description:
        "Read a spreadsheet as a markdown table of its displayed values, up to 200 rows.",
      inputSchema: z.object({
        spreadsheetId: z.string().describe("A spreadsheet id from search_workspace"),
      }),
      execute: async ({ spreadsheetId }) =>
        (await readSpreadsheet(ctx, options, spreadsheetId)) ?? NOT_ACCESSIBLE,
    }),

    read_project: tool({
      description:
        "Read a project: name, key, description and up to 50 of its tasks with status, open tasks first.",
      inputSchema: z.object({
        projectId: z.string().describe("A project id from search_workspace"),
      }),
      execute: async ({ projectId }) =>
        (await readProject(ctx, options, projectId)) ?? NOT_ACCESSIBLE,
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
        const read = await ctx.runQuery(internal.assistantReads.listChannelMessages, {
          userId,
          channelId,
          limit: limit ?? 30,
        });
        if (!read) return NOT_ACCESSIBLE;
        return {
          channel: read.channel,
          messages: read.messages.map((message) => ({
            author: message.author,
            at: new Date(message.at).toISOString(),
            text: message.text,
          })),
        };
      },
    }),
  };
}
