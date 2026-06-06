"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { markdownToBlocks } from "../../lib/headlessEditor";

/**
 * Convert an inbound GitHub comment's markdown body into the BlockNote JSON
 * that Ripple stores and renders. The same translation strategy as
 * `seedDescriptionAction` — a headless `@blocknote/core` editor under a JSDOM
 * shim — but simpler: comments are a plain `taskComments.body` string, not a
 * collaborative Yjs document, so the output is just `JSON.stringify(blocks)`
 * rather than a Yjs snapshot.
 *
 * The markdown → blocks conversion runs through the shared headless editor
 * (`lib/headlessEditor` → `markdownToBlocks`), which owns the JSDOM shim and the
 * bundle-size reasons we avoid `@blocknote/server-util`. Markdown import only
 * yields default block types, which `taskCommentSchema` is a superset of, so the
 * JSON loads cleanly on the client without replicating the custom inline specs
 * (userMention/eventMention) here.
 *
 * Scheduled (runAfter 0) from `applyCommentCreated` / `applyCommentEdited`.
 * Best-effort: the comment row already holds the raw markdown, which renders as
 * plain text via the client's `parseCommentBody` fallback until this lands.
 */
export const seedCommentBody = internalAction({
  args: { commentId: v.id("taskComments"), markdown: v.string() },
  returns: v.null(),
  handler: async (ctx, { commentId, markdown }) => {
    if (markdown.trim().length === 0) return null;

    const blocks = await markdownToBlocks(markdown);
    if (blocks.length === 0) return null;

    await ctx.runMutation(internal.taskComments.setBodyFromMarkdown, {
      commentId,
      json: JSON.stringify(blocks),
      sourceMarkdown: markdown,
    });

    return null;
  },
});
