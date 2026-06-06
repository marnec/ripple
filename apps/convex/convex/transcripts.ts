"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { markdownToYjsUpdate } from "./lib/headlessEditor";
import { hintFromUrl, transcriptToMarkdown } from "./transcriptFormat";

/**
 * Ingest a finished call's transcript into a new Ripple document.
 *
 * Triggered by the Cloudflare `meeting.transcript` webhook (see
 * `http.ts` → `/realtime/transcript-webhook`), which fires once after a
 * transcribed call's session ends and carries a short-lived download URL for
 * the consolidated transcript. Because Cloudflare produces this server-side,
 * the document survives every client leaving the call — including the host
 * leaving early or everyone closing their tab.
 *
 * Seeds via the headless editor (`lib/headlessEditor` → `markdownToYjsUpdate`,
 * shared with task-description and comment seeding): documents are collaborative
 * Yjs docs, so "saving" the transcript means producing the cold-start snapshot
 * that PartyKit's `onLoad` hydrates from.
 */
export const ingestTranscript = internalAction({
  args: {
    cloudflareMeetingId: v.string(),
    cloudflareSessionId: v.optional(v.string()),
    transcriptDownloadUrl: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { cloudflareMeetingId, cloudflareSessionId, transcriptDownloadUrl },
  ) => {
    const session = await ctx.runQuery(
      internal.callSessions.getSessionByMeeting,
      { cloudflareMeetingId },
    );
    if (!session) {
      console.warn(
        `ingestTranscript: no call session for meeting ${cloudflareMeetingId}; ignoring.`,
      );
      return null;
    }
    // Idempotency: a document was already produced for this call. The
    // documents delete-trigger clears this FK if that doc is later removed, so
    // a dangling id can't occur — a simple presence check is sufficient.
    if (session.transcriptDocumentId) return null;

    const channel = await ctx.runQuery(
      internal.callSessions.getChannelForTranscript,
      { channelId: session.channelId },
    );
    if (!channel) {
      console.warn(
        `ingestTranscript: channel ${session.channelId} gone; skipping transcript doc.`,
      );
      return null;
    }

    const res = await fetch(transcriptDownloadUrl);
    if (!res.ok) {
      throw new Error(
        `ingestTranscript: transcript download failed (${res.status})`,
      );
    }
    const raw = await res.text();
    const markdown = transcriptToMarkdown(raw, hintFromUrl(transcriptDownloadUrl));
    if (markdown.trim().length === 0) {
      console.warn(
        `ingestTranscript: empty transcript for meeting ${cloudflareMeetingId}; skipping.`,
      );
      return null;
    }

    // Name carries the channel + when (date & time, to disambiguate multiple
    // calls in a day). The word "transcript" lives on the `transcript` tag, not
    // the name. No `# heading` inside the body — the doc title is the name.
    const stamp = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const name = `${channel.name} call — ${stamp}`;

    // Markdown → Yjs cold-start snapshot via the headless editor (it owns the
    // JSDOM shim + BlockNote/Yjs encoding). `null` would mean the markdown
    // produced no blocks; it's non-empty here, so that's vanishingly unlikely.
    const update = await markdownToYjsUpdate(markdown);
    if (!update) return null;
    const storageId = await ctx.storage.store(
      new Blob([update as BlobPart], { type: "application/octet-stream" }),
    );

    const documentId = await ctx.runMutation(
      internal.documents.createForTranscript,
      { workspaceId: channel.workspaceId, name, channelId: session.channelId },
    );

    const won = await ctx.runMutation(
      internal.callSessions.attachTranscriptDocument,
      { sessionId: session._id, documentId, cloudflareSessionId },
    );

    if (!won) {
      // A concurrent delivery already attached a document. Drop our snapshot
      // blob; the orphan doc row is harmless and rare (logged for visibility).
      await ctx.storage.delete(storageId);
      console.warn(
        `ingestTranscript: lost attach race for meeting ${cloudflareMeetingId}; orphan doc ${documentId}.`,
      );
      return null;
    }

    await ctx.runMutation(internal.snapshots.saveSnapshot, {
      resourceType: "doc",
      resourceId: documentId,
      storageId,
    });

    return null;
  },
});
