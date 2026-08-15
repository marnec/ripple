import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { paginationOptsValidator } from "convex/server";
import { getAll } from "convex-helpers/server/relationships";
import { extractEventMentionIds, extractMentionedUserIds, extractPlainTextFromBody, extractProjectIds, extractResourceReferenceIds, extractTaskMentionIds } from "./utils/blocknote";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { isMessageEditable } from "@ripple/shared/constants";
import { DatabaseReader } from "./_generated/server";
import { requireChannelAccess, filterChannelRecipients } from "./authHelpers";
import { notify } from "./utils/notify";
import { normalizeIds } from "./utils/ids";

/**
 * Name + image and nothing else — the same projection `users.get` returns, for
 * the same reason. See `enrichWithMentionedUsers`.
 */
const mentionedUsersValidator = v.record(v.string(), v.object({
  name: v.union(v.string(), v.null()),
  image: v.optional(v.string()),
}));
const mentionedTasksValidator = v.record(v.string(), v.object({
  title: v.string(),
  projectId: v.string(),
  statusColor: v.optional(v.string()),
}));
const mentionedProjectsValidator = v.record(v.string(), v.object({
  name: v.string(),
  color: v.string(),
}));
const mentionedResourcesValidator = v.record(v.string(), v.object({
  name: v.string(),
  type: v.union(v.literal("document"), v.literal("diagram"), v.literal("spreadsheet")),
}));
const mentionedEventsValidator = v.record(v.string(), v.object({
  title: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  deleted: v.boolean(),
}));

const enrichedMessageValidator = v.object({
  _id: v.id("messages"),
  _creationTime: v.number(),
  userId: v.id("users"),
  isomorphicId: v.string(),
  body: v.string(),
  plainText: v.string(),
  channelId: v.id("channels"),
  deleted: v.boolean(),
  replyToId: v.optional(v.id("messages")),
  author: v.string(),
  authorImage: v.optional(v.string()),
  replyTo: v.union(v.null(), v.object({ author: v.string(), plainText: v.string(), deleted: v.boolean(), imageUrl: v.optional(v.string()) })),
  mentionedUsers: mentionedUsersValidator,
  mentionedTasks: mentionedTasksValidator,
  mentionedProjects: mentionedProjectsValidator,
  mentionedResources: mentionedResourcesValidator,
  mentionedEvents: mentionedEventsValidator,
});

/**
 * Every id these helpers dereference is lifted out of a message `body`, which
 * `send` takes as an opaque `v.string()`. That makes them client-authored
 * strings twice over: they need not address a live row, and they need not
 * belong to this channel's workspace. So each one goes through `normalizeIds`
 * before it reaches `getAll` — a hand-edited mention naming nothing at all
 * would otherwise throw and take the whole channel's message list down for
 * everyone — and then through a `workspaceId` comparison before its name
 * reaches the reader. Without the second check, posting a foreign id into a DM
 * you control turns chat into a live subscription on another tenant's resource
 * titles, re-shipping on every rename. Same hardening `favorites.toggle`,
 * `favorites.resolveResource` and `graph.getNodeLabel` already carry.
 *
 * A row that fails either check is simply omitted from the record, which is
 * what a deleted row already did — the reader cannot tell "not yours" from
 * "gone", so the check leaks nothing itself. `enrichWithMentionedEvents` is the
 * exception only in shape: it reports `deleted: true` because its client
 * renders a tombstone.
 */

/**
 * Enrich messages with mentionedUsers record, batch-resolving all @mentions
 * found in message bodies so the client can render them instantly.
 *
 * `users` rows are not workspace-scoped, so there is no workspace comparison to
 * make here — the recipient-side gate is `filterChannelRecipients`. What carries
 * the security value on *this* path is the projection, exactly as in `users.get`
 * (see its doc-comment): the ids come out of a `v.string()` body, so any
 * signed-in caller can name any account in the deployment and read back whatever
 * this record carries. `name` and `image` are what `users.get` already hands to
 * anyone holding an id — including unauthenticated guests on a shared document —
 * so resolving them here adds no reach. `email` did: it turned a chat message
 * into a userId→e-mail oracle for accounts sharing no workspace, no channel and
 * nothing else with the reader, which is the input to phishing and
 * credential-stuffing. It is not emitted, and must not come back.
 *
 * Deliberately NOT narrowed to channel members: it would not close anything (the
 * client falls back to `api.users.get` for an unresolved id and renders the same
 * name and avatar) and it would break a legitimate case — mentioning someone
 * before they are added, or after they leave, still has to render as a person.
 */
async function enrichWithMentionedUsers<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  userMap: Map<string, Doc<"users"> | null>,
): Promise<(T & { mentionedUsers: Record<string, { name: string | null; image?: string }> })[]> {
  // Collect all mentioned user IDs across all message bodies
  const allMentionedIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractMentionedUserIds(msg.body)) {
      allMentionedIds.add(id);
    }
  }

  // Batch-fetch any not already in userMap
  const missingIds = normalizeIds(
    ctx.db,
    "users",
    [...allMentionedIds].filter(id => !userMap.has(id)),
  );
  if (missingIds.length > 0) {
    const fetched = await getAll(ctx.db, missingIds);
    fetched.forEach((u, i) => {
      userMap.set(missingIds[i], u);
    });
  }

  // Build per-message mentionedUsers record
  return messages.map(msg => {
    const mentionedIds = extractMentionedUserIds(msg.body);
    const mentionedUsers: Record<string, { name: string | null; image?: string }> = {};
    for (const id of mentionedIds) {
      const u = userMap.get(id);
      if (u) {
        mentionedUsers[id] = { name: u.name ?? null, image: u.image };
      }
    }
    return { ...msg, mentionedUsers };
  });
}

/**
 * Enrich messages with mentionedTasks record, batch-resolving all #task mentions.
 */
async function enrichWithMentionedTasks<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  workspaceId: Id<"workspaces">,
): Promise<(T & { mentionedTasks: Record<string, { title: string; projectId: string; statusColor?: string }> })[]> {
  const allTaskIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractTaskMentionIds(msg.body)) {
      allTaskIds.add(id);
    }
  }

  const taskIds = normalizeIds(ctx.db, "tasks", [...allTaskIds]);
  const taskMap = new Map<string, { title: string; projectId: string; statusId: Id<"taskStatuses"> } | null>();
  if (taskIds.length > 0) {
    const tasks = await getAll(ctx.db, taskIds);
    tasks.forEach((t, i) => {
      taskMap.set(
        taskIds[i],
        t && t.workspaceId === workspaceId
          ? { title: t.title, projectId: t.projectId, statusId: t.statusId }
          : null,
      );
    });
  }

  // Batch-fetch statuses for all tasks. Every id here came off a task already
  // proven to be in this workspace, so it needs no comparison of its own.
  const statusIds = [...new Set(
    [...taskMap.values()].filter(t => t).map(t => t!.statusId)
  )];
  const statusMap = new Map<string, string>();
  if (statusIds.length > 0) {
    const statuses = await getAll(ctx.db, statusIds);
    statuses.forEach((s, i) => {
      if (s) statusMap.set(statusIds[i], s.color);
    });
  }

  return messages.map(msg => {
    const ids = extractTaskMentionIds(msg.body);
    const mentionedTasks: Record<string, { title: string; projectId: string; statusColor?: string }> = {};
    for (const id of ids) {
      const t = taskMap.get(id);
      if (t) {
        mentionedTasks[id] = { title: t.title, projectId: t.projectId, statusColor: statusMap.get(t.statusId) };
      }
    }
    return { ...msg, mentionedTasks };
  });
}

/**
 * Enrich messages with mentionedProjects record, batch-resolving all #project references.
 */
async function enrichWithMentionedProjects<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  workspaceId: Id<"workspaces">,
): Promise<(T & { mentionedProjects: Record<string, { name: string; color: string }> })[]> {
  const allProjectIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractProjectIds(msg.body)) {
      allProjectIds.add(id);
    }
  }

  const projectIds = normalizeIds(ctx.db, "projects", [...allProjectIds]);
  const projectMap = new Map<string, { name: string; color: string } | null>();
  if (projectIds.length > 0) {
    const projects = await getAll(ctx.db, projectIds);
    projects.forEach((p, i) => {
      projectMap.set(
        projectIds[i],
        p && p.workspaceId === workspaceId ? { name: p.name, color: p.color } : null,
      );
    });
  }

  return messages.map(msg => {
    const ids = extractProjectIds(msg.body);
    const mentionedProjects: Record<string, { name: string; color: string }> = {};
    for (const id of ids) {
      const p = projectMap.get(id);
      if (p) {
        mentionedProjects[id] = p;
      }
    }
    return { ...msg, mentionedProjects };
  });
}

/**
 * Enrich messages with mentionedResources record, batch-resolving
 * document, diagram, and spreadsheet references.
 */
async function enrichWithMentionedResources<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  workspaceId: Id<"workspaces">,
): Promise<(T & { mentionedResources: Record<string, { name: string; type: "document" | "diagram" | "spreadsheet" }> })[]> {
  // Collect all resource refs across all messages
  const allRefs = new Map<string, string>(); // id → type
  for (const msg of messages) {
    for (const ref of extractResourceReferenceIds(msg.body)) {
      allRefs.set(ref.id, ref.type);
    }
  }

  // Group IDs by table for batch fetching. `resourceType` is client-authored
  // too, so an id is only ever normalized against the table its ref names —
  // a "document" ref addressing a diagram row is dropped, not cross-read.
  const rawDocIds: string[] = [];
  const rawDiagramIds: string[] = [];
  const rawSheetIds: string[] = [];
  for (const [id, type] of allRefs) {
    if (type === "document") rawDocIds.push(id);
    else if (type === "diagram") rawDiagramIds.push(id);
    else if (type === "spreadsheet") rawSheetIds.push(id);
  }
  const docIds = normalizeIds(ctx.db, "documents", rawDocIds);
  const diagramIds = normalizeIds(ctx.db, "diagrams", rawDiagramIds);
  const sheetIds = normalizeIds(ctx.db, "spreadsheets", rawSheetIds);

  // Batch-fetch from each table
  const resourceMap = new Map<string, { name: string; type: "document" | "diagram" | "spreadsheet" }>();

  if (docIds.length > 0) {
    const docs = await getAll(ctx.db, docIds);
    docs.forEach((d, i) => {
      if (d && d.workspaceId === workspaceId) resourceMap.set(docIds[i], { name: d.name, type: "document" });
    });
  }
  if (diagramIds.length > 0) {
    const diagrams = await getAll(ctx.db, diagramIds);
    diagrams.forEach((d, i) => {
      if (d && d.workspaceId === workspaceId) resourceMap.set(diagramIds[i], { name: d.name, type: "diagram" });
    });
  }
  if (sheetIds.length > 0) {
    const sheets = await getAll(ctx.db, sheetIds);
    sheets.forEach((s, i) => {
      if (s && s.workspaceId === workspaceId) resourceMap.set(sheetIds[i], { name: s.name, type: "spreadsheet" });
    });
  }

  return messages.map(msg => {
    const refs = extractResourceReferenceIds(msg.body);
    const mentionedResources: Record<string, { name: string; type: "document" | "diagram" | "spreadsheet" }> = {};
    for (const ref of refs) {
      const r = resourceMap.get(ref.id);
      if (r) mentionedResources[ref.id] = r;
    }
    return { ...msg, mentionedResources };
  });
}

/**
 * Enrich messages with mentionedEvents record, batch-resolving all @event
 * mentions. Events are workspace-scoped reads (matches diagrams/tasks/projects)
 * so the only access check is the cross-workspace guard — a stray paste from
 * another workspace surfaces as `deleted: true` without leaking metadata.
 */
async function enrichWithMentionedEvents<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  workspaceId: Id<"workspaces">,
): Promise<(T & { mentionedEvents: Record<string, { title?: string; startsAt?: number; endsAt?: number; deleted: boolean }> })[]> {
  const allEventIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractEventMentionIds(msg.body)) {
      allEventIds.add(id);
    }
  }

  const eventIds = normalizeIds(ctx.db, "calendarEvents", [...allEventIds]);
  const eventMap = new Map<string, { title?: string; startsAt?: number; endsAt?: number; deleted: boolean }>();
  if (eventIds.length > 0) {
    const events = await getAll(ctx.db, eventIds);
    events.forEach((e, i) => {
      const id = eventIds[i];
      if (!e || e.workspaceId !== workspaceId) {
        eventMap.set(id, { deleted: true });
      } else {
        eventMap.set(id, { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, deleted: false });
      }
    });
  }

  return messages.map(msg => {
    const ids = extractEventMentionIds(msg.body);
    const mentionedEvents: Record<string, { title?: string; startsAt?: number; endsAt?: number; deleted: boolean }> = {};
    for (const id of ids) {
      const e = eventMap.get(id);
      if (e) mentionedEvents[id] = e;
    }
    return { ...msg, mentionedEvents };
  });
}

/**
 * Enrich messages with replyTo info, resolving mention text from parent bodies.
 * Shared by list, search, and getMessageContext queries.
 */
async function enrichWithReplyTo<
  T extends { channelId: Id<"channels">; replyToId?: Id<"messages"> },
>(
  ctx: { db: DatabaseReader },
  messages: T[],
  userMap: Map<string, Doc<"users"> | null>,
): Promise<(T & { replyTo: { author: string; plainText: string; deleted: boolean; imageUrl?: string } | null })[]> {
  // Batch-fetch parent messages
  const parentIds = [...new Set(
    messages.filter(m => m.replyToId).map(m => m.replyToId!)
  )];
  const fetched = parentIds.length > 0 ? await getAll(ctx.db, parentIds) : [];

  // A reply may only quote a message from its OWN channel. `send` enforces that
  // on the way in, but the read side has to hold the same line: `replyTo`
  // re-derives the parent's *current* body, so a cross-channel parent here is a
  // live feed out of a closed channel or DM into whatever channel the reply sits
  // in — exactly what the channel rule exists to prevent. The comparison is
  // against each *replying message's* own channel rather than a query-level
  // channelId: this helper is handed rows, not a channel, so it stays correct
  // if a caller ever assembles a page spanning channels.
  const channelsReferencing = new Map<string, Set<string>>();
  for (const m of messages) {
    if (!m.replyToId) continue;
    const seen = channelsReferencing.get(m.replyToId) ?? new Set<string>();
    seen.add(m.channelId);
    channelsReferencing.set(m.replyToId, seen);
  }
  // Drop foreign parents before any of their content is read, so the name and
  // project lookups below never touch a message the reader cannot see.
  const parents = fetched.map((p, i) =>
    p && channelsReferencing.get(parentIds[i])?.has(p.channelId) ? p : null,
  );
  const parentMap = new Map(parents.map((p, i) => [parentIds[i], p]));

  // Collect parent author user IDs not already in userMap
  const missingParentUserIds = [...new Set(
    parents.filter(p => p && !userMap.has(p.userId)).map(p => p!.userId)
  )];

  // Also collect user IDs mentioned inside parent bodies
  const mentionedUserIds = [...new Set(
    parents.filter(p => p?.body).flatMap(p => extractMentionedUserIds(p!.body))
  )].filter(id => !userMap.has(id));

  const allMissingIds = [...new Set([...missingParentUserIds, ...mentionedUserIds])];
  if (allMissingIds.length > 0) {
    const fetched = await getAll(ctx.db, allMissingIds as Id<"users">[]);
    fetched.forEach((u, i) => {
      if (u) userMap.set(allMissingIds[i], u);
    });
  }

  // Build user name map for mention text extraction
  const userNameMap = new Map<string, string>();
  for (const [id, u] of userMap) {
    if (u) userNameMap.set(id, getUserDisplayName(u));
  }

  // Batch-fetch project names for parent message mentions
  const allParentProjectIds = [...new Set(
    parents.filter(p => p?.body).flatMap(p => extractProjectIds(p!.body))
  )];
  const projectNameMap = new Map<string, string>();
  if (allParentProjectIds.length > 0) {
    const projects = await getAll(ctx.db, allParentProjectIds as any);
    projects.forEach((p, i) => {
      if (p && "name" in p) projectNameMap.set(allParentProjectIds[i], (p as any).name);
    });
  }

  // Enrich each message
  return messages.map((msg) => {
    if (!msg.replyToId) {
      return { ...msg, replyTo: null };
    }
    const parent = parentMap.get(msg.replyToId);
    // Same-channel check repeated per message: one parent id can be referenced
    // from more than one channel, and only the same-channel references may
    // resolve it.
    if (!parent || parent.channelId !== msg.channelId) {
      return { ...msg, replyTo: null };
    }
    const parentUser = userMap.get(parent.userId);
    const plainText = extractPlainTextFromBody(parent.body, userNameMap, projectNameMap) || parent.plainText;
    let imageUrl: string | undefined;
    try {
      const blocks: { type: string; props?: { url?: string } }[] = JSON.parse(parent.body);
      imageUrl = blocks.find((b) => b.type === "image")?.props?.url;
    } catch {
      // non-JSON body — no image
    }
    return {
      ...msg,
      replyTo: {
        author: getUserDisplayName(parentUser),
        plainText,
        deleted: parent.deleted,
        ...(imageUrl ? { imageUrl } : {}),
      },
    };
  });
}

/**
 * Run the full mention/reply enrichment pipeline for a page of messages.
 *
 * `enrichWithReplyTo` and `enrichWithMentionedUsers` both populate the shared
 * `userMap`, so they run first and in order. The remaining four passes only read
 * each message `body` and are mutually independent, so they run concurrently —
 * collapsing six sequential DB round-trip waves into three and removing the
 * artificial serialization between the task/project/resource/event lookups.
 *
 * Shared by `list`, `search`, and `getMessageContext` so the chat read path has
 * one enrichment definition rather than three drifting copies.
 */
async function enrichMessages<
  T extends { body: string; channelId: Id<"channels">; replyToId?: Id<"messages"> },
>(
  ctx: { db: DatabaseReader },
  messages: T[],
  userMap: Map<string, Doc<"users"> | null>,
  workspaceId: Id<"workspaces">,
) {
  const withReplyTo = await enrichWithReplyTo(ctx, messages, userMap);
  const withUsers = await enrichWithMentionedUsers(ctx, withReplyTo, userMap);
  const [tasks, projects, resources, events] = await Promise.all([
    enrichWithMentionedTasks(ctx, withUsers, workspaceId),
    enrichWithMentionedProjects(ctx, withUsers, workspaceId),
    enrichWithMentionedResources(ctx, withUsers, workspaceId),
    enrichWithMentionedEvents(ctx, withUsers, workspaceId),
  ]);
  return withUsers.map((m, i) => ({
    ...m,
    mentionedTasks: tasks[i].mentionedTasks,
    mentionedProjects: projects[i].mentionedProjects,
    mentionedResources: resources[i].mentionedResources,
    mentionedEvents: events[i].mentionedEvents,
  }));
}

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(enrichedMessageValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { channelId, paginationOpts }) => {
    const { channel } = await requireChannelAccess(ctx, channelId);

    // Grab the most recent messages
    const messagesPage = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) => q.eq("channelId", channelId).eq("deleted", false))
      .order("desc")
      .paginate(paginationOpts);

    // Batch fetch all users for the messages (cleaner than N+1 pattern)
    const userIds = [...new Set(messagesPage.page.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add the author's name and image to each message
    const messagesWithAuthor = messagesPage.page.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: getUserDisplayName(user), authorImage: user?.image };
    });

    const page = await enrichMessages(ctx, messagesWithAuthor, userMap, channel.workspaceId);

    return {
      ...messagesPage,
      page,
    };
  },
});

/**
 * The text a push notification shows for a message, read out of its body.
 *
 * `body` and `plainText` are independent args on `send` — the client composes
 * both and nothing makes them agree — so taking the notification from
 * `plainText` lets a sender put one thing in the channel and a different thing
 * on every recipient's lock screen. Everything here comes from `body`, resolved
 * through the same name maps `enrichWithReplyTo` builds so the preview reads
 * "@Alice" rather than "@user".
 *
 * A snapshot-only message has no text at all; its label is the diagram name the
 * composer wrote onto the image block, which is part of `body` too — so the
 * empty case doesn't have to fall back to the untrusted arg.
 *
 * The `workspaceId` comparisons are the same guard the read path carries: this
 * is the one place a foreign name escapes the app entirely, onto a lock screen,
 * so a project or event the sender pasted from another tenant renders as the
 * raw mention rather than its title.
 */
async function pushTextFromBody(
  ctx: { db: DatabaseReader },
  body: string,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const userIds = normalizeIds(ctx.db, "users", extractMentionedUserIds(body));
  const projectIds = normalizeIds(ctx.db, "projects", extractProjectIds(body));
  const eventIds = normalizeIds(ctx.db, "calendarEvents", extractEventMentionIds(body));

  const userNames = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await getAll(ctx.db, userIds);
    users.forEach((u, i) => {
      if (u) userNames.set(userIds[i], getUserDisplayName(u));
    });
  }

  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const projects = await getAll(ctx.db, projectIds);
    projects.forEach((p, i) => {
      if (p && p.workspaceId === workspaceId) projectNames.set(projectIds[i], p.name);
    });
  }

  const eventTitles = new Map<string, string>();
  if (eventIds.length > 0) {
    const events = await getAll(ctx.db, eventIds);
    events.forEach((e, i) => {
      if (e && e.workspaceId === workspaceId) eventTitles.set(eventIds[i], e.title);
    });
  }

  const text = extractPlainTextFromBody(body, userNames, projectNames, eventTitles);
  return text || imageLabelFromBody(body);
}

/** The diagram name a snapshot message carries on its image block, if any. */
function imageLabelFromBody(body: string): string {
  try {
    const blocks: { type: string; props?: { diagramName?: string } }[] = JSON.parse(body);
    return blocks.find((b) => b.type === "image")?.props?.diagramName ?? "";
  } catch {
    // non-JSON body — nothing to label it with
    return "";
  }
}

export const send = mutation({
  args: {
    isomorphicId: v.string(),
    body: v.string(),
    plainText: v.string(),
    channelId: v.id("channels"),
    replyToId: v.optional(v.id("messages")),
  },
  returns: v.null(),
  handler: async (ctx, { body, channelId, plainText, isomorphicId, replyToId }) => {
    const { userId, channel } = await requireChannelAccess(ctx, channelId);

    const user: Doc<"users"> | null = await ctx.db.get(userId);
    if (!user) throw new ConvexError(`No users found with id=${userId}`);

    // `replyToId` is a read primitive, not just a pointer: the list/search
    // enrichment resolves it to the parent's author and current body and hands
    // that to everyone in THIS channel. A parent from another channel would
    // therefore republish gated content — reactively, since edits keep flowing
    // — to an audience the channel rule never admitted. Only a message id the
    // sender could already read here is accepted.
    if (replyToId) {
      const parent = await ctx.db.get(replyToId);
      if (!parent || parent.channelId !== channelId) {
        throw new ConvexError("Cannot reply to a message from another channel");
      }
    }

    await ctx.db.insert("messages", {
      body,
      userId,
      channelId,
      plainText,
      isomorphicId,
      deleted: false,
      replyToId,
    });

    // What every push below says, read out of the stored body — never out of
    // the `plainText` arg, which travels beside `body` and need not agree with it.
    const pushText = await pushTextFromBody(ctx, body, channel.workspaceId);

    // Extract @mentions and schedule chat mention notifications. The mention
    // list decides who receives the message's opening lines, so it goes through
    // the channel rule before it reaches `notify` — the composer's @-picker is
    // fed workspace members, which in a closed channel or DM is a wider set.
    const mentionedUserIds = extractMentionedUserIds(body).filter(id => id !== userId);
    const mentionRecipients = await filterChannelRecipients(ctx, channel, mentionedUserIds);

    if (mentionRecipients.length > 0) {
      await notify(ctx, {
        category: "chatMention",
        userId,
        userName: getUserDisplayName(user),
        recipientIds: mentionRecipients,
        resourceId: channelId,
        title: `${getUserDisplayName(user)} mentioned you in #${channel.name}`,
        body: pushText.length > 100 ? pushText.slice(0, 97) + "..." : pushText,
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      });
    }

    await notify(ctx, {
      category: "chatChannelMessage",
      userId,
      userName: getUserDisplayName(user),
      scope: channelId,
      title: getUserDisplayName(user),
      body: pushText,
      url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
    });
    return null;
  },
});

/**
 * Editing and deleting take the channel rule first and authorship second, the
 * same order `messageReactions.toggle` uses on the same table: a message is
 * channel data, and authoring it once is not a standing grant over it. Gating on
 * authorship alone made removal from a channel not revoke write access — an
 * ejected member could still rewrite the body current members are subscribed to
 * (for the 48h `isMessageEditable` window) and soft-delete it (no window at
 * all), silently rewriting the `plainText` that `search` indexes.
 *
 * The rule runs before the authorship comparison so a non-member gets "not a
 * member of this channel" rather than "not authorized to update this message",
 * which would confirm the id addresses a real message in a channel they cannot
 * see.
 */
export const update = mutation({
  args: { id: v.id("messages"), body: v.string(), plainText: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, body, plainText }) => {
    const message = await ctx.db.get(id);
    if (!message) throw new ConvexError("Message not found");
    const { userId } = await requireChannelAccess(ctx, message.channelId);

    if (message.userId !== userId) throw new ConvexError("Not authorized to update this message");
    if (!isMessageEditable(message._creationTime)) throw new ConvexError("Edit window has expired");

    await ctx.db.patch(id, { body, plainText });

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const message = await ctx.db.get(id);
    if (!message) throw new ConvexError("Message not found");
    const { userId } = await requireChannelAccess(ctx, message.channelId);

    if (message.userId !== userId) throw new ConvexError("Not authorized to delete this message");

    await ctx.db.patch(id, { deleted: true });

    return null;
  },
});

export const search = query({
  args: {
    channelId: v.id("channels"),
    searchTerm: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.array(enrichedMessageValidator),
  handler: async (ctx, { channelId, searchTerm, limit = 20 }) => {
    const { channel } = await requireChannelAccess(ctx, channelId);

    // Search for messages
    const searchResults = await ctx.db
      .query("messages")
      .withSearchIndex("by_text", (q) =>
        q.search("plainText", searchTerm).eq("channelId", channelId)
      )
      .take(limit);

    // Batch fetch all users for the search results
    const userIds = [...new Set(searchResults.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add author information
    const searchResultsWithAuthor = searchResults.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: getUserDisplayName(user), authorImage: user?.image };
    });

    return enrichMessages(ctx, searchResultsWithAuthor, userMap, channel.workspaceId);
  },
});

export const getMessageContext = query({
  args: {
    messageId: v.id("messages"),
    contextSize: v.optional(v.number())
  },
  returns: v.object({
    messages: v.array(enrichedMessageValidator),
    targetMessageId: v.id("messages"),
    targetIndex: v.number(),
  }),
  handler: async (ctx, { messageId, contextSize = 10 }) => {
    const targetMessage = await ctx.db.get(messageId);
    if (!targetMessage) throw new ConvexError(`Message not found`);

    const { channel } = await requireChannelAccess(ctx, targetMessage.channelId);

    // Get messages before and after the target message
    const messagesBefore = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) =>
        q.eq("channelId", targetMessage.channelId).eq("deleted", false).lt("_creationTime", targetMessage._creationTime)
      )
      .order("desc")
      .take(contextSize);

    const messagesAfter = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) =>
        q.eq("channelId", targetMessage.channelId).eq("deleted", false).gt("_creationTime", targetMessage._creationTime)
      )
      .order("asc")
      .take(contextSize);

    // Combine and sort all messages
    const allMessages = [...messagesBefore.reverse(), targetMessage, ...messagesAfter];

    // Batch fetch all users for the messages
    const userIds = [...new Set(allMessages.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add author information
    const messagesWithAuthor = allMessages.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: getUserDisplayName(user), authorImage: user?.image };
    });

    const page = await enrichMessages(ctx, messagesWithAuthor, userMap, channel.workspaceId);

    return {
      messages: page,
      targetMessageId: messageId,
      targetIndex: messagesBefore.length // Index of the target message in the results
    };
  },
});
