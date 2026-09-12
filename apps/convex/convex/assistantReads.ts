import { v } from "convex/values";
import { getAll } from "convex-helpers/server/relationships";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import {
  checkChannelAccessAs,
  checkResourceMemberAs,
  collabResourceValidator,
  getWorkspaceMembership,
} from "./authHelpers";
import { documentValidator } from "./documents";
import { pickProjectFields, projectValidator } from "./validators";
import { channelLabel } from "./lib/dmLabel";
import { nodeResultValidator, searchableTypeValidator, searchNodes } from "./nodes";
import { storedSnapshotAs } from "./snapshots";
import { spreadsheetValidator } from "./spreadsheets";
import { enrichedTaskValidator, enrichTask } from "./tasks";

/**
 * The reads behind the **assistant tools** (`lib/assistantTools.ts`), one
 * internal query per read, each taking the **summoner**'s user id as data.
 *
 * The tools run inside actions. The writing assistant's HTTP action carries
 * the caller's auth identity; the chat reply runs on a workpool and carries
 * none. Reading through the public queries would give the first surface the
 * right access and the second no access at all — so both pass the summoner
 * explicitly, and each query here applies exactly the rule its public twin
 * applies (`documents.get`, `snapshots.getSnapshotUrl`, …) through the same
 * helper, with the user id as an argument instead of resolved from `ctx.auth`.
 *
 * This module is the only read path the tools may use; a guard test pins it.
 * There is no third access rule here, and there must never be: every query
 * below is a projection of `checkResourceMemberAs`, `checkChannelAccessAs`
 * or `hasResourceAccess` (ADR 0003).
 */

/**
 * `documents.get`, as the summoner. Null for a missing document, a document
 * in a workspace the summoner is not in, or an id that is not a document —
 * one answer, so the tool cannot reveal which.
 */
export const getDocument = internalQuery({
  args: { userId: v.id("users"), documentId: v.string() },
  returns: v.union(documentValidator, v.null()),
  handler: async (ctx, { userId, documentId }) => {
    const id = ctx.db.normalizeId("documents", documentId);
    if (!id) return null;
    const result = await checkResourceMemberAs(ctx, "documents", id, userId);
    return result ? result.resource : null;
  },
});

/**
 * `snapshots.getSnapshotUrl`, as the summoner, answering with the blob id
 * rather than a URL: the action reads the blob itself. `empty` is a resource
 * nobody has written into yet, which the tool reports as empty text;
 * `unavailable` covers gone, foreign and denied alike.
 */
export const getSnapshot = internalQuery({
  args: {
    userId: v.id("users"),
    resourceType: collabResourceValidator,
    resourceId: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("stored"), storageId: v.id("_storage") }),
    v.object({ status: v.literal("empty") }),
    v.object({ status: v.literal("unavailable") }),
  ),
  handler: async (ctx, { userId, resourceType, resourceId }) => {
    return storedSnapshotAs(ctx, userId, resourceType, resourceId);
  },
});

/**
 * `nodes.search`, as the summoner: the workspace rule, then the same name
 * search Ctrl+K runs. A summoner outside the workspace gets an empty list,
 * which is what Ctrl+K gives a non-member too.
 */
export const search = internalQuery({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    searchText: v.string(),
    resourceType: v.optional(searchableTypeValidator),
  },
  returns: v.array(nodeResultValidator),
  handler: async (ctx, { userId, workspaceId, searchText, resourceType }) => {
    const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
    if (!membership) return [];
    return searchNodes(ctx, workspaceId, searchText, resourceType);
  },
});

/** `tasks.get`, as the summoner. */
export const getTask = internalQuery({
  args: { userId: v.id("users"), taskId: v.string() },
  returns: v.union(enrichedTaskValidator, v.null()),
  handler: async (ctx, { userId, taskId }) => {
    const id = ctx.db.normalizeId("tasks", taskId);
    if (!id) return null;
    const result = await checkResourceMemberAs(ctx, "tasks", id, userId);
    return result ? enrichTask(ctx, result.resource) : null;
  },
});

/** `spreadsheets.get`, as the summoner. The grid itself comes via `getSnapshot`. */
export const getSpreadsheet = internalQuery({
  args: { userId: v.id("users"), spreadsheetId: v.string() },
  returns: v.union(spreadsheetValidator, v.null()),
  handler: async (ctx, { userId, spreadsheetId }) => {
    const id = ctx.db.normalizeId("spreadsheets", spreadsheetId);
    if (!id) return null;
    const result = await checkResourceMemberAs(ctx, "spreadsheets", id, userId);
    return result ? result.resource : null;
  },
});

/** The most tasks a project read lists. Open ones first; the rest is a count. */
export const PROJECT_TASKS_MAX = 50;

const projectTaskValidator = v.object({
  title: v.string(),
  number: v.union(v.number(), v.null()),
  status: v.union(v.string(), v.null()),
  completed: v.boolean(),
});

/**
 * `projects.get`, as the summoner, plus what "how is it going" needs: up to
 * `PROJECT_TASKS_MAX` of its tasks with title and status, open tasks first,
 * and how many were left out. Two index ranges rather than one sort: the
 * open range fills first, and completed tasks only take the room left.
 */
export const getProject = internalQuery({
  args: { userId: v.id("users"), projectId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      project: projectValidator,
      tasks: v.array(projectTaskValidator),
      /** Tasks beyond the cap, not listed. */
      omitted: v.number(),
    }),
  ),
  handler: async (ctx, { userId, projectId }) => {
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id) return null;
    const result = await checkResourceMemberAs(ctx, "projects", id, userId);
    if (!result) return null;

    const open = await ctx.db
      .query("tasks")
      .withIndex("by_project_completed", (q) => q.eq("projectId", id).eq("completed", false))
      .take(PROJECT_TASKS_MAX + 1);
    const room = Math.max(0, PROJECT_TASKS_MAX + 1 - Math.min(open.length, PROJECT_TASKS_MAX));
    const done =
      room > 0
        ? await ctx.db
            .query("tasks")
            .withIndex("by_project_completed", (q) => q.eq("projectId", id).eq("completed", true))
            .take(room)
        : [];
    const all = [...open, ...done];
    const listed = all.slice(0, PROJECT_TASKS_MAX);
    // Both ranges were read one past the cap, so "one more" is exact up to
    // that and a floor beyond it; the count is a note to the model, not a
    // figure to report.
    const omitted = all.length - listed.length;

    const statusIds = [...new Set(listed.map((task) => task.statusId))];
    const statuses = await getAll(ctx.db, statusIds);
    const statusNames = new Map<Id<"taskStatuses">, string>();
    statusIds.forEach((statusId, i) => {
      const status = statuses[i];
      if (status) statusNames.set(statusId, status.name);
    });

    return {
      project: pickProjectFields(result.resource),
      tasks: listed.map((task) => ({
        title: task.title,
        number: task.number ?? null,
        status: statusNames.get(task.statusId) ?? null,
        completed: task.completed,
      })),
      omitted,
    };
  },
});

/** The most recent messages a reply may read from one channel, at most. */
export const CHANNEL_MESSAGES_MAX = 100;

/**
 * `channels.get` + `messages.list`, as the summoner, in one read: the channel
 * rule (`checkChannelAccessAs` — a private channel or a DM the summoner is
 * not in is null), then the channel's newest undeleted messages, returned
 * oldest first with their authors' display names. Null for gone and denied
 * alike.
 */
export const listChannelMessages = internalQuery({
  args: {
    userId: v.id("users"),
    channelId: v.string(),
    limit: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      channel: v.string(),
      messages: v.array(
        v.object({ author: v.string(), at: v.number(), text: v.string() }),
      ),
    }),
  ),
  handler: async (ctx, { userId, channelId, limit }) => {
    const id = ctx.db.normalizeId("channels", channelId);
    if (!id) return null;
    const access = await checkChannelAccessAs(ctx, id, userId);
    if (!access) return null;

    const newestFirst = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) => q.eq("channelId", id).eq("deleted", false))
      .order("desc")
      .take(Math.max(1, Math.min(limit, CHANNEL_MESSAGES_MAX)));
    const window = newestFirst.reverse();

    const authorIds = [...new Set(window.map((m) => m.userId))];
    const authors = await getAll(ctx.db, authorIds);
    const names = new Map<Id<"users">, string>();
    authorIds.forEach((authorId, i) => names.set(authorId, getUserDisplayName(authors[i])));

    return {
      channel: await channelLabel(ctx, access.channel, userId),
      messages: window.map((message: Doc<"messages">) => ({
        author: names.get(message.userId) ?? "Unknown",
        at: message._creationTime,
        text: message.plainText,
      })),
    };
  },
});
