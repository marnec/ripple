"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { JSDOM } from "jsdom";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { transcriptToMarkdown } from "./transcriptFormat";

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
 * Reuses the proven headless seed pipeline (`@blocknote/core` + JSDOM →
 * `blocksToYDoc` → Yjs snapshot in `_storage`; see `seedDescriptionAction`):
 * documents are collaborative Yjs docs, so "saving" the transcript means
 * producing the cold-start snapshot that PartyKit's `onLoad` hydrates from.
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
    const lower = transcriptDownloadUrl.toLowerCase();
    const hint = lower.includes(".csv")
      ? "csv"
      : lower.includes(".vtt")
        ? "vtt"
        : lower.includes(".srt")
          ? "srt"
          : lower.includes(".json")
            ? "json"
            : undefined;
    const markdown = transcriptToMarkdown(raw, hint);
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
    const docMarkdown = markdown;

    // Headless markdown → BlockNote blocks → Yjs snapshot. BlockNote's parser
    // walks the DOM, so install a transient document/window for the conversion.
    const dom = new JSDOM(
      "<!DOCTYPE html><html><head></head><body></body></html>",
    );
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { window?: unknown }).window = dom.window;
    (globalThis as { document?: unknown }).document = dom.window.document;

    let storageId;
    try {
      const editor = BlockNoteEditor.create();
      const blocks = await editor.tryParseMarkdownToBlocks(docMarkdown);
      if (blocks.length === 0) return null;
      const ydoc = blocksToYDoc(editor, blocks, "document-store");
      const update = Y.encodeStateAsUpdate(ydoc);
      storageId = await ctx.storage.store(
        new Blob([update as BlobPart], {
          type: "application/octet-stream",
        }),
      );
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
      (globalThis as { document?: unknown }).document = prevDocument;
    }

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
