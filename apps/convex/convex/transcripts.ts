"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { markdownToYjsUpdate } from "./lib/headlessEditor";
import {
  transcriptHintValidator,
  transcriptToMarkdown,
} from "./transcriptFormat";

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
 * **Takes bytes, not a URL.** The webhook route downloads inside the request
 * and stores the raw transcript, so this action can be run again: the URL is
 * short-lived and Cloudflare will not redeliver an event it has already been
 * acked. That is what makes the retry below meaningful — re-running from a dead
 * URL would only reproduce the failure. The raw blob stays unreferenced and is
 * collected by `storageGc` an hour after the job ends, however it ended, which
 * also leaves a window to replay a conversion that gave up.
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
    storageId: v.id("_storage"),
    formatHint: v.optional(transcriptHintValidator),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { cloudflareMeetingId, cloudflareSessionId, storageId, formatHint },
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
    // Idempotency: a *finished* document was already produced for this call.
    // Not merely an attached one — an attempt that died between the attach and
    // the snapshot save leaves an empty document behind, and this attempt is
    // the one that fills it in (see `getSessionByMeeting`). The documents
    // delete-trigger clears the FK when the doc goes, so it never dangles.
    const attachedDocumentId = session.transcriptDocumentId;
    if (attachedDocumentId && !session.transcriptDocumentNeedsSnapshot) {
      return null;
    }

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

    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      // The bytes are gone and there is no URL to fetch them from again, so no
      // attempt can succeed. Throwing would only burn the retries.
      console.error(
        `ingestTranscript: stored transcript ${storageId} missing for meeting ${cloudflareMeetingId}.`,
      );
      return null;
    }
    const raw = await blob.text();
    const markdown = transcriptToMarkdown(raw, formatHint);
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
    // `channel.name` is already the derived label for a DM: this runs in an
    // action with no `ctx.db`, and the query that supplied it
    // (`callSessions.getChannelForTranscript`) resolves it.
    const name = `${channel.name} call — ${stamp}`;

    // Markdown → Yjs cold-start snapshot via the headless editor (it owns the
    // JSDOM shim + BlockNote/Yjs encoding). `null` would mean the markdown
    // produced no blocks; it's non-empty here, so that's vanishingly unlikely.
    const update = await markdownToYjsUpdate(markdown);
    if (!update) return null;
    const snapshotStorageId = await ctx.storage.store(
      new Blob([update as BlobPart], { type: "application/octet-stream" }),
    );

    // Resuming a half-finished ingest writes into the document that is already
    // attached; there is nothing to create and nothing to race for.
    let documentId = attachedDocumentId;
    if (!documentId) {
      documentId = await ctx.runMutation(
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
        await ctx.storage.delete(snapshotStorageId);
        console.warn(
          `ingestTranscript: lost attach race for meeting ${cloudflareMeetingId}; orphan doc ${documentId}.`,
        );
        return null;
      }
    }

    await ctx.runMutation(internal.snapshots.saveSnapshot, {
      resourceType: "doc",
      resourceId: documentId,
      storageId: snapshotStorageId,
    });

    return null;
  },
});
