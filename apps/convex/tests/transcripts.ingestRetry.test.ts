/**
 * Sweep #11 — the transcript ingestion path's failure behaviour.
 *
 * The webhook used to ack Cloudflare with a 200 and hand the *download URL* to
 * a scheduled action. A scheduled action is at-most-once (see the headers on
 * `subscriptionPool.ts` and `emailDelivery.ts`), the URL is short-lived, and
 * Cloudflare had already been told the delivery succeeded — so a two-second
 * blip on the transcript CDN lost the transcript permanently, with the only
 * evidence a log line in a 7-day window.
 *
 * These tests pin the three properties that replace that: the ack is withheld
 * when the download fails, the conversion replays from bytes we already hold
 * rather than from a URL that expires, and a conversion that gives up leaves a
 * row an operator can read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, setupWorkspaceWithAdmin, channelFields } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

const WEBHOOK_SECRET = "test-webhook-secret";
const DOWNLOAD_URL = "https://cf.example/transcript.csv";

const realFetch = global.fetch;

/**
 * The conversion's failure seam. `markdownToYjsUpdate` is the JSDOM/BlockNote
 * step, and everything after it is a mutation — so this stands in for the whole
 * class of transient failures the drain can hit (a cold Node start, an OCC
 * conflict on the document write) at the one place they are all injectable.
 */
const injected = vi.hoisted(() => ({
  /** Number of leading conversion attempts that throw. */
  failFirst: 0,
  /** Every attempt throws — the retries-exhausted case. */
  failAlways: false,
  attempts: 0,
}));

vi.mock("../convex/lib/headlessEditor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/headlessEditor")>();
  return {
    ...actual,
    markdownToYjsUpdate: async (
      ...args: Parameters<typeof actual.markdownToYjsUpdate>
    ) => {
      injected.attempts += 1;
      if (injected.failAlways || injected.attempts <= injected.failFirst) {
        throw new Error("injected conversion failure");
      }
      return actual.markdownToYjsUpdate(...args);
    },
  };
});

beforeEach(() => {
  injected.failFirst = 0;
  injected.failAlways = false;
  injected.attempts = 0;
  vi.stubEnv("CLOUDFLARE_RTK_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * The transcript CDN. Every entry is one response for one call, so a test can
 * say "succeeds once, then the URL is dead" — which is the whole reason the
 * bytes have to be captured on the first and only attempt.
 */
function mockDownloads(...responses: Array<() => Response>) {
  const calls: string[] = [];
  let i = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return next();
  }) as typeof global.fetch;
  return calls;
}

const ok = (body: string) => () => new Response(body, { status: 200 });
const failing = (status: number) => () => new Response("nope", { status });

const CSV_TRANSCRIPT = [
  "name,transcript",
  "Alice,Hello team.",
  "Bob,Morning.",
].join("\n");

async function seedChannelWithSession(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
  meetingId: string,
) {
  return t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "general",
      workspaceId,
      ...channelFields("open"),
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

function deliver(
  t: ReturnType<typeof createTestContext>,
  meetingId: string,
  url: string = DOWNLOAD_URL,
) {
  return t.fetch(`/realtime/transcript-webhook?secret=${WEBHOOK_SECRET}`, {
    method: "POST",
    body: JSON.stringify({
      event: "meeting.transcript",
      meeting: { id: meetingId, sessionId: "sess-1" },
      transcriptDownloadUrl: url,
    }),
  });
}

describe("transcript webhook — download failure", () => {
  /**
   * The ack is a promise that the transcript is ours now. Cloudflare's webhook
   * retry is the only redelivery that exists — nothing on our side can ask for
   * a fresh URL — so a failed download must be answered with a status that
   * makes it redeliver, not with the 200 that retires the event.
   */
  it("withholds the ack when the transcript download fails", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-down");

    mockDownloads(failing(503));

    const res = await deliver(t, "meet-down");

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("transcript webhook — handoff to the conversion", () => {
  /**
   * The URL is single-use in practice: by the time anything downstream of the
   * ack runs, it may already be dead. So the ack must capture the bytes, and
   * everything after it must work from those bytes — never from the URL again.
   * The download is mocked to succeed exactly once and be gone afterwards,
   * which is the state a slow conversion genuinely finds it in.
   */
  it("downloads once and produces the document without re-reading the URL", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { sessionId } = await seedChannelWithSession(t, workspaceId, "meet-once");

    const calls = mockDownloads(ok(CSV_TRANSCRIPT), failing(410));

    const res = await deliver(t, "meet-once");
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toEqual([DOWNLOAD_URL]);

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs).toHaveLength(1);
    expect(docs[0].yjsSnapshotId).toBeDefined();
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(docs[0]._id);
  });
});

describe("transcript conversion — retry", () => {
  /**
   * Replayability is only worth having if something replays. The conversion is
   * a cold-starting Node action followed by three mutations, every one of which
   * can fail transiently; at-most-once turned any of them into a lost
   * transcript, and the URL that could have produced another one is gone.
   */
  it("still produces the document when the conversion throws once", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { sessionId } = await seedChannelWithSession(t, workspaceId, "meet-flap");

    mockDownloads(ok(CSV_TRANSCRIPT), failing(410));
    injected.failFirst = 1;

    expect((await deliver(t, "meet-flap")).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(injected.attempts).toBeGreaterThan(1);
    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs).toHaveLength(1);
    expect(docs[0].yjsSnapshotId).toBeDefined();
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(docs[0]._id);
  });

  /**
   * And when it never converges, the give-up has to leave a row rather than a
   * log line in a 7-day window. This is the transcript's only trace: Cloudflare
   * has been acked, the raw bytes sit in storage under an id nothing points at,
   * and the channel shows no transcript at all. The row names both the drain
   * and the meeting so the blob can be found and the conversion re-run.
   */
  it("records a background job failure once retries are exhausted", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-dead");

    mockDownloads(ok(CSV_TRANSCRIPT), failing(410));
    injected.failAlways = true;

    expect((await deliver(t, "meet-dead")).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const failures = await t.run((ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("transcripts:ingestTranscript");
    expect(failures[0].key).toBe("meet-dead");
    expect(failures[0].error).toContain("injected conversion failure");
    expect(failures[0].failedAt).toEqual(expect.any(Number));

    expect(
      await t.run((ctx) => ctx.db.query("documents").collect()),
    ).toHaveLength(0);
  });

  /**
   * The state a give-up leaves *between* the attach and the snapshot save: the
   * session points at a document, so every later attempt reads that as "already
   * ingested" and returns — successfully — leaving an empty document titled
   * after the call and no failure row anywhere. Retry turned a lost transcript
   * into a permanently blank one, which is worse, so the idempotency guard has
   * to mean "already ingested", not "already attached".
   *
   * Seeded as state rather than by failing a mutation: this is precisely the
   * pair of rows a crash between those two writes commits.
   */
  it("finishes an ingest that attached a document but never saved its snapshot", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { channelId, sessionId } = await seedChannelWithSession(
      t,
      workspaceId,
      "meet-half",
    );

    const documentId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("documents", {
        workspaceId,
        name: "general call — half-written",
        tags: ["transcript"],
      });
      await ctx.db.patch(sessionId, { transcriptDocumentId: id });
      return id;
    });

    mockDownloads(ok(CSV_TRANSCRIPT), failing(410));
    expect((await deliver(t, "meet-half")).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The existing document is filled in — not duplicated, not left blank.
    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs).toHaveLength(1);
    expect(docs[0]._id).toBe(documentId);
    expect(docs[0].yjsSnapshotId).toBeDefined();
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(documentId);
    expect(session?.channelId).toBe(channelId);
  });

  /**
   * The other half of that guard: a genuine duplicate delivery — a document
   * that already has its snapshot — must still be left completely alone, or
   * every redelivery would overwrite a transcript someone may have edited.
   */
  it("leaves a fully ingested transcript untouched on a duplicate delivery", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-dup");

    mockDownloads(ok(CSV_TRANSCRIPT));
    await deliver(t, "meet-dup");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const first = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(first).toHaveLength(1);

    await deliver(t, "meet-dup");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const second = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(second).toHaveLength(1);
    expect(second[0].yjsSnapshotId).toBe(first[0].yjsSnapshotId);
  });
});

/**
 * Sweep #21 — how the route authenticates, independent of what it then does
 * with the payload.
 */
describe("transcript webhook — secret handling", () => {
  const body = JSON.stringify({
    event: "meeting.transcript",
    meeting: { id: "meet-auth", sessionId: "sess-1" },
    transcriptDownloadUrl: DOWNLOAD_URL,
  });

  it("accepts the secret in the x-webhook-secret header", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-auth");
    mockDownloads(ok(CSV_TRANSCRIPT));

    // The header is now read FIRST, so a hook registered this way never puts
    // the secret in a URL. The `?secret=` form stays supported below.
    const res = await t.fetch("/realtime/transcript-webhook", {
      method: "POST",
      headers: { "x-webhook-secret": WEBHOOK_SECRET },
      body,
    });

    expect(res.status).toBe(200);
  });

  it("still accepts the secret in the query string", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-auth");
    mockDownloads(ok(CSV_TRANSCRIPT));

    const res = await t.fetch(
      `/realtime/transcript-webhook?secret=${WEBHOOK_SECRET}`,
      { method: "POST", body },
    );

    expect(res.status).toBe(200);
  });

  it("rejects a wrong secret from either channel", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedChannelWithSession(t, workspaceId, "meet-auth");

    const viaHeader = await t.fetch("/realtime/transcript-webhook", {
      method: "POST",
      headers: { "x-webhook-secret": `${WEBHOOK_SECRET}x` },
      body,
    });
    const viaQuery = await t.fetch(
      `/realtime/transcript-webhook?secret=${WEBHOOK_SECRET}x`,
      { method: "POST", body },
    );
    const missing = await t.fetch("/realtime/transcript-webhook", {
      method: "POST",
      body,
    });

    expect(viaHeader.status).toBe(401);
    expect(viaQuery.status).toBe(401);
    expect(missing.status).toBe(401);
  });
});
