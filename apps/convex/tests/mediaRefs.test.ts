import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelVisibility } from "@ripple/shared/enums/roles";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { withTriggers } from "../convex/dbTriggers";
import { ORPHANED_MEDIA_GRACE_MS } from "../convex/storageGc";
import { mediaTokenFromUrl } from "../convex/utils/mediaTokens";
import { createTestContext, setupProject, setupWorkspaceWithAdmin } from "./helpers";

/**
 * Upload lifetime: an upload lives as long as some content shows it, plus a
 * grace period. Content stores URLs, so `medias.token` is the join; owners
 * restate their references on every write (`mediaRefs.syncOwnerRefs`), and
 * `storageGc.sweepOrphanedMedias` collects what has been unreferenced for the
 * grace period. Uploads predating this are untouched until `mediaBackfill`
 * has accounted for them.
 */

type T = ReturnType<typeof createTestContext>;

// convex-test's storage URLs end in the blob's base64 sha256, not the uuid a
// real deployment mints, so the production pattern (deliberately strict — see
// `utils/mediaTokens`) never matches them. Map those fake URLs onto
// uuid-shaped tokens; the real pattern is covered in `mediaTokens.test.ts`.
vi.mock("../convex/utils/mediaTokens", async (importOriginal) => {
  const real = await importOriginal<typeof import("../convex/utils/mediaTokens")>();
  const FAKE_URL = /some-deployment\.convex\.cloud\/api\/storage\/([A-Za-z0-9+/]{43}=)/g;
  const toToken = (sha: string) => {
    const hex = [...atob(sha)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };
  const extractMediaTokens = (text: string) => [
    ...new Set([
      ...real.extractMediaTokens(text),
      ...[...text.matchAll(FAKE_URL)].map((m) => toToken(m[1])),
    ]),
  ];
  return {
    ...real,
    extractMediaTokens,
    mediaTokenFromUrl: (url: string) => extractMediaTokens(url)[0] ?? null,
  };
});

/** Distinct bytes per blob: convex-test derives the URL from the content hash. */
function uniqueBlob() {
  return new Blob([crypto.getRandomValues(new Uint8Array(16))]);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function upload(t: T, asUser: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"], workspaceId: Id<"workspaces">) {
  const storageId = await t.run((ctx) => ctx.storage.store(uniqueBlob()));
  const url = await asUser.mutation(api.medias.saveMedia, {
    storageId,
    workspaceId,
    fileName: "log.txt",
    mimeType: "text/plain",
    size: 8,
    type: "file",
  });
  const media = await t.run(async (ctx) =>
    ctx.db
      .query("medias")
      .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
      .unique(),
  );
  return { url, storageId, mediaId: media!._id };
}

/** A body that embeds `url` the way the composers do — a `file` block. */
function bodyWithFile(url: string) {
  return JSON.stringify([
    { type: "file", props: { url, name: "log.txt" } },
    { type: "paragraph", content: [{ type: "text", text: "see attached", styles: {} }] },
  ]);
}
const plainBody = JSON.stringify([{ type: "paragraph", content: [] }]);

function getMedia(t: T, mediaId: Id<"medias">) {
  return t.run((ctx) => ctx.db.get(mediaId));
}
function refsOf(t: T, mediaId: Id<"medias">) {
  return t.run((ctx) =>
    ctx.db
      .query("mediaRefs")
      .withIndex("by_media", (q) => q.eq("mediaId", mediaId))
      .collect(),
  );
}

async function setupChannel(t: T) {
  const ws = await setupWorkspaceWithAdmin(t);
  const channelId = await ws.asUser.mutation(api.channels.create, {
    workspaceId: ws.workspaceId,
    name: "general",
    visibility: ChannelVisibility.PUBLIC,
  });
  return { ...ws, channelId };
}

async function sendMessage(t: T, ctx: Awaited<ReturnType<typeof setupChannel>>, body: string) {
  await ctx.asUser.mutation(api.messages.send, {
    isomorphicId: crypto.randomUUID(),
    body,
    plainText: "see attached",
    channelId: ctx.channelId,
  });
  return t.run(async (db) => {
    const rows = await db.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", ctx.channelId))
      .collect();
    return rows[rows.length - 1]._id;
  });
}

async function setupTask(t: T, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  return t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "To Do",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "Crash on login",
      statusId,
      priority: "medium" as const,
      completed: false,
      creatorId: userId,
      number: 1,
    });
  });
}

describe("upload references", () => {
  it("records a new upload as tracked and orphaned until content uses it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { url, mediaId } = await upload(t, asUser, workspaceId);

    const media = await getMedia(t, mediaId);
    expect(media?.token).toBe(mediaTokenFromUrl(url));
    expect(media?.tracked).toBe(true);
    expect(media?.orphanedAt).toBeTypeOf("number");
  });

  it("follows a message: sent → referenced, edited out or deleted → orphaned", async () => {
    const t = createTestContext();
    const chat = await setupChannel(t);
    const { url, mediaId } = await upload(t, chat.asUser, chat.workspaceId);

    const messageId = await sendMessage(t, chat, bodyWithFile(url));
    expect(await refsOf(t, mediaId)).toHaveLength(1);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeUndefined();

    await chat.asUser.mutation(api.messages.update, { id: messageId, body: plainBody, plainText: "" });
    expect(await refsOf(t, mediaId)).toHaveLength(0);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeTypeOf("number");

    await chat.asUser.mutation(api.messages.update, {
      id: messageId,
      body: bodyWithFile(url),
      plainText: "",
    });
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeUndefined();

    await chat.asUser.mutation(api.messages.remove, { id: messageId });
    expect(await refsOf(t, mediaId)).toHaveLength(0);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeTypeOf("number");
  });

  it("keeps an upload shown by two messages until both let go", async () => {
    const t = createTestContext();
    const chat = await setupChannel(t);
    const { url, mediaId } = await upload(t, chat.asUser, chat.workspaceId);

    const first = await sendMessage(t, chat, bodyWithFile(url));
    await sendMessage(t, chat, bodyWithFile(url));
    await chat.asUser.mutation(api.messages.remove, { id: first });

    expect(await refsOf(t, mediaId)).toHaveLength(1);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeUndefined();
  });

  it("follows a task comment, and releases it when the comment is hard-deleted", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, userId } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, workspaceId, userId);
    const { url, mediaId } = await upload(t, asUser, workspaceId);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: bodyWithFile(url),
      bodyMarkdown: "see attached",
    });
    expect(await refsOf(t, mediaId)).toHaveLength(1);

    await t.run((ctx) => withTriggers(ctx).db.delete(commentId));
    expect(await refsOf(t, mediaId)).toHaveLength(0);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeTypeOf("number");
  });

  it("syncs a collaborative resource from its snapshot, and releases it on delete", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { url, mediaId } = await upload(t, asUser, workspaceId);
    const documentId = await t.run((ctx) => ctx.db.insert("documents", { workspaceId, name: "Spec" }));
    const save = async (mediaTokens?: string[]) => {
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(4)])));
      await t.mutation(internal.snapshots.saveSnapshot, {
        resourceType: "doc",
        resourceId: documentId,
        storageId,
        mediaTokens,
      });
    };

    await save([mediaTokenFromUrl(url)!]);
    expect(await refsOf(t, mediaId)).toHaveLength(1);

    // A writer that cannot embed uploads leaves references alone.
    await save(undefined);
    expect(await refsOf(t, mediaId)).toHaveLength(1);

    await t.run((ctx) => withTriggers(ctx).db.delete(documentId));
    expect(await refsOf(t, mediaId)).toHaveLength(0);
    expect((await getMedia(t, mediaId))?.orphanedAt).toBeTypeOf("number");
  });
});

describe("attachments stay in Ripple", () => {
  async function linkTask(t: T, workspaceId: Id<"workspaces">, taskId: Id<"tasks">) {
    await t.run(async (ctx) => {
      const task = (await ctx.db.get(taskId))!;
      const linkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId: task.projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "repo-1",
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: linkId,
        externalIssueId: "issue-1",
        externalUpdatedAt: Date.now(),
        externalAuthor: { login: "octocat", avatarUrl: "", url: "" },
      });
    });
  }

  it("refuses an upload on a comment that would be pushed to the provider", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, userId } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, workspaceId, userId);
    await linkTask(t, workspaceId, taskId);
    const { url } = await upload(t, asUser, workspaceId);

    await expect(
      asUser.mutation(api.taskComments.create, { taskId, body: bodyWithFile(url), bodyMarkdown: "x" }),
    ).rejects.toThrow(/private notes/);

    // A public comment cannot gain one by being edited either.
    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: plainBody,
      bodyMarkdown: "x",
    });
    await expect(
      asUser.mutation(api.taskComments.update, { id: commentId, body: bodyWithFile(url), bodyMarkdown: "x" }),
    ).rejects.toThrow(/private notes/);
  });

  it("accepts an upload on a private note of a linked task", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, userId } = await setupWorkspaceWithAdmin(t);
    const taskId = await setupTask(t, workspaceId, userId);
    await linkTask(t, workspaceId, taskId);
    const { url, mediaId } = await upload(t, asUser, workspaceId);

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: bodyWithFile(url),
      bodyMarkdown: "x",
      internal: true,
    });
    expect(await refsOf(t, mediaId)).toHaveLength(1);
  });
});

describe("storageGc.sweepOrphanedMedias", () => {
  it("collects only tracked uploads unreferenced for longer than the grace period", async () => {
    const t = createTestContext();
    const chat = await setupChannel(t);
    const stale = await upload(t, chat.asUser, chat.workspaceId);
    const fresh = await upload(t, chat.asUser, chat.workspaceId);
    const used = await upload(t, chat.asUser, chat.workspaceId);
    await sendMessage(t, chat, bodyWithFile(used.url));
    // A pre-tracking upload: no token, never stamped — must survive.
    const legacyStorage = await t.run((ctx) => ctx.storage.store(uniqueBlob()));
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("medias", {
        storageId: legacyStorage,
        workspaceId: chat.workspaceId,
        uploadedBy: chat.userId,
        fileName: "old.png",
        mimeType: "image/png",
        size: 2,
        type: "image",
      }),
    );

    const longAgo = Date.now() - ORPHANED_MEDIA_GRACE_MS - 1000;
    await t.run((ctx) => ctx.db.patch(stale.mediaId, { orphanedAt: longAgo }));

    await t.mutation(internal.storageGc.sweepOrphanedMedias, {});

    expect(await getMedia(t, stale.mediaId)).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(stale.storageId))).toBeNull();
    expect(await getMedia(t, fresh.mediaId)).not.toBeNull();
    expect(await getMedia(t, used.mediaId)).not.toBeNull();
    expect(await getMedia(t, legacyId)).not.toBeNull();
  });

  it("spares an upload whose stamp is stale but that is referenced", async () => {
    const t = createTestContext();
    const chat = await setupChannel(t);
    const { url, mediaId } = await upload(t, chat.asUser, chat.workspaceId);
    await sendMessage(t, chat, bodyWithFile(url));
    await t.run((ctx) => ctx.db.patch(mediaId, { orphanedAt: 1 }));

    await t.mutation(internal.storageGc.sweepOrphanedMedias, {});

    const media = await getMedia(t, mediaId);
    expect(media).not.toBeNull();
    expect(media?.orphanedAt).toBeUndefined();
  });
});

describe("mediaBackfill", () => {
  it("tracks old uploads by what references them, and starts the clock on the rest", async () => {
    const t = createTestContext();
    const chat = await setupChannel(t);

    // Three pre-tracking uploads: shown by a message, shown by a document
    // snapshot, and shown by nothing.
    const legacy = async (name: string) => {
      const storageId = await t.run((ctx) => ctx.storage.store(uniqueBlob()));
      const id = await t.run((ctx) =>
        ctx.db.insert("medias", {
          storageId,
          workspaceId: chat.workspaceId,
          uploadedBy: chat.userId,
          fileName: name,
          mimeType: "image/png",
          size: 4,
          type: "image",
        }),
      );
      const url = (await t.run((ctx) => ctx.storage.getUrl(storageId)))!;
      return { id, url };
    };
    const inMessage = await legacy("chat.png");
    const inDocument = await legacy("doc.png");
    const unused = await legacy("unused.png");

    // Content written before references existed: raw inserts, no triggers.
    await t.run((ctx) =>
      ctx.db.insert("messages", {
        userId: chat.userId,
        isomorphicId: "legacy",
        body: bodyWithFile(inMessage.url),
        plainText: "",
        channelId: chat.channelId,
        deleted: false,
      }),
    );
    const snapshot = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([1, 2]), new TextEncoder().encode(`"url":"${inDocument.url}"`)]),
      ),
    );
    await t.run((ctx) =>
      ctx.db.insert("documents", { workspaceId: chat.workspaceId, name: "Spec", yjsSnapshotId: snapshot }),
    );

    await t.mutation(internal.mediaBackfill.start, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const kept of [inMessage, inDocument]) {
      const media = await getMedia(t, kept.id);
      expect(media).toMatchObject({ tracked: true, token: mediaTokenFromUrl(kept.url) });
      expect(media?.orphanedAt).toBeUndefined();
      expect(await refsOf(t, kept.id)).toHaveLength(1);
    }
    const orphan = await getMedia(t, unused.id);
    expect(orphan?.tracked).toBe(true);
    expect(orphan?.orphanedAt).toBeTypeOf("number");
  });
});
