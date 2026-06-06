import { describe, it, expect, afterEach, vi } from "vitest";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { internal } from "../convex/_generated/api";
import { triggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelType } from "@ripple/shared/enums/roles";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockTranscriptDownload(payload: string) {
  global.fetch = vi.fn(
    async () => new Response(payload, { status: 200 }),
  ) as typeof global.fetch;
}

async function seedChannelWithSession(
  t: ReturnType<typeof createTestContext>,
  workspaceId: string,
  meetingId: string,
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "general",
      workspaceId: workspaceId as never,
      type: ChannelType.OPEN,
    });
    const sessionId = await ctx.db.insert("callSessions", {
      channelId,
      cloudflareMeetingId: meetingId,
      active: false,
      transcribe: true,
    });
    return { channelId, sessionId };
  });
}

describe("ingestTranscript", () => {
  it("creates a transcript document with a snapshot and links the session", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { sessionId } = await seedChannelWithSession(t, workspaceId, "meet-1");

    mockTranscriptDownload(
      JSON.stringify([
        { name: "Alice", transcript: "Hello team." },
        { name: "Bob", transcript: "Morning." },
      ]),
    );

    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "meet-1",
      cloudflareSessionId: "sess-1",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.length).toBe(1);
    expect(docs[0].name).toContain("general call");
    expect(docs[0].name).not.toContain("transcript"); // tag, not name
    expect(docs[0].tags).toContain("transcript");
    expect(docs[0].yjsSnapshotId).toBeDefined();

    // The `transcript` tag is registered in the workspace dictionary + join.
    const tagDict = await t.run((ctx) =>
      ctx.db.query("tags").collect(),
    );
    expect(tagDict.map((t2) => t2.name)).toContain("transcript");
    const entityTags = await t.run((ctx) =>
      ctx.db.query("entityTags").collect(),
    );
    expect(
      entityTags.some(
        (et) => et.tagName === "transcript" && et.resourceId === docs[0]._id,
      ),
    ).toBe(true);

    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(docs[0]._id);
    expect(session?.cloudflareSessionId).toBe("sess-1");

    // A `transcript_of` edge links the document → its channel.
    const edges = await t.run((ctx) => ctx.db.query("edges").collect());
    expect(
      edges.some(
        (e) =>
          e.edgeType === "transcript_of" &&
          e.sourceId === docs[0]._id &&
          e.targetId === session!.channelId,
      ),
    ).toBe(true);
  });

  it("reuses a preexisting `transcript` tag instead of duplicating it", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-tag");

    // A `transcript` tag already exists in the workspace.
    await t.run((ctx) =>
      ctx.db.insert("tags", { workspaceId: workspaceId as never, name: "transcript" }),
    );

    mockTranscriptDownload(
      JSON.stringify([{ name: "Alice", transcript: "Reuse me." }]),
    );
    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "meet-tag",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });

    const transcriptTags = await t.run((ctx) =>
      ctx.db.query("tags").collect(),
    );
    expect(
      transcriptTags.filter((t2) => t2.name === "transcript").length,
    ).toBe(1);
  });

  it("is idempotent — a duplicate delivery makes no second document", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-2");

    mockTranscriptDownload(
      JSON.stringify([{ name: "Alice", transcript: "Once." }]),
    );

    const args = {
      cloudflareMeetingId: "meet-2",
      transcriptDownloadUrl: "https://cf.example/transcript",
    };
    await t.action(internal.transcripts.ingestTranscript, args);
    await t.action(internal.transcripts.ingestTranscript, args);

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.length).toBe(1);
  });

  it("clears the session FK when the transcript doc is deleted (trigger), and re-ingest regenerates", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { sessionId } = await seedChannelWithSession(t, workspaceId, "meet-del");

    mockTranscriptDownload(
      JSON.stringify([{ name: "Alice", transcript: "First." }]),
    );
    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "meet-del",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });

    const firstDocId = await t.run(
      async (ctx) => (await ctx.db.get(sessionId))!.transcriptDocumentId!,
    );

    // Delete the document through writerWithTriggers so the documents
    // delete-trigger fires (the real delete path goes through it too).
    await t.run(async (ctx) => {
      await writerWithTriggers(ctx, ctx.db, triggers).delete(firstDocId);
    });

    // Trigger cleared the dangling FK.
    const afterDelete = await t.run((ctx) => ctx.db.get(sessionId));
    expect(afterDelete?.transcriptDocumentId).toBeUndefined();

    // With the FK cleared, a re-delivery regenerates the document.
    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "meet-del",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });
    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.length).toBe(1);
    expect(docs[0]._id).not.toBe(firstDocId);
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(docs[0]._id);
  });

  it("skips when no call session matches the meeting", async () => {
    const t = createTestContext();
    await setupWorkspaceWithAdmin(t);

    mockTranscriptDownload(JSON.stringify([{ name: "X", transcript: "Y" }]));

    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "unknown-meeting",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.length).toBe(0);
  });

  it("skips when the transcript download is empty", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { sessionId } = await seedChannelWithSession(t, workspaceId, "meet-3");

    mockTranscriptDownload("   ");

    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "meet-3",
      transcriptDownloadUrl: "https://cf.example/transcript",
    });

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.length).toBe(0);
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBeUndefined();
  });
});
