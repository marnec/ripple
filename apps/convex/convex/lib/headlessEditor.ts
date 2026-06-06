"use node";

import { JSDOM } from "jsdom";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc } from "@blocknote/core/yjs";
import * as Y from "yjs";

/** The block array a default-schema editor produces from markdown. */
type ParsedBlocks = Awaited<
  ReturnType<BlockNoteEditor["tryParseMarkdownToBlocks"]>
>;

/**
 * The headless editor: a BlockNote editor running server-side under a JSDOM
 * shim, with no React/UI. It's how Ripple turns markdown into the structures
 * the client renders — BlockNote JSON (comments) or a Yjs snapshot (documents
 * and task descriptions, which are collaborative Yjs docs whose cold-start
 * source is a binary snapshot in `_storage`).
 *
 * This module exists so that exactly one place owns two awkward facts:
 *
 *  1. BlockNote's markdown parser walks the DOM, so a `window`/`document` must
 *     exist for the conversion. We install a transient JSDOM and — critically —
 *     restore the previous globals in a `finally`, because we're mutating
 *     process-global state. Getting this wrong leaks a fake `window` into every
 *     later action in the same isolate. It was previously hand-rolled in three
 *     separate actions; `withBlockNoteDom` is now the single, tested home.
 *
 *  2. We deliberately use `@blocknote/core` (+ `@blocknote/core/yjs`) rather
 *     than `@blocknote/server-util`: server-util pulls `@blocknote/react`, which
 *     drags `react-icons` (~22 MiB) + emoji data into the Node external-package
 *     artifact (no tree-shaking on externals), blowing Convex's ~43 MiB ceiling.
 *     The headless core has everything the conversion needs and none of the UI.
 *
 * Markdown import only yields default block types. Every client schema
 * (`taskDescriptionSchema`, `taskCommentSchema`, the document schema) is a
 * superset of the defaults, so the output loads cleanly without replicating the
 * custom blocks (diagram/spreadsheet/mentions/…) server-side.
 *
 * `"use node"` because of the JSDOM dependency. Returns plain values (blocks /
 * bytes) and takes no Convex `ctx`: callers keep their own `ctx.storage.store`,
 * idempotency checks, and seed-status transitions, and these helpers stay
 * unit-testable in isolation (see `tests/headlessEditor.test.ts`).
 */

/**
 * Run `fn` with a transient BlockNote editor under a JSDOM `window`/`document`,
 * restoring whatever globals were there before. The only safe way to touch
 * BlockNote's DOM-dependent APIs in a Convex Node action.
 */
async function withBlockNoteDom<T>(
  fn: (editor: BlockNoteEditor) => T | Promise<T>,
): Promise<Awaited<T>> {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body></body></html>",
  );
  const g = globalThis as { window?: unknown; document?: unknown };
  const prevWindow = g.window;
  const prevDocument = g.document;
  g.window = dom.window;
  g.document = dom.window.document;
  try {
    const editor = BlockNoteEditor.create();
    return await fn(editor);
  } finally {
    g.window = prevWindow;
    g.document = prevDocument;
  }
}

/**
 * Parse markdown into BlockNote blocks (default schema). Returns `[]` for blank
 * input or content that yields no blocks — callers decide what "nothing to
 * seed" means for them.
 */
export async function markdownToBlocks(
  markdown: string,
): Promise<ParsedBlocks> {
  if (markdown.trim().length === 0) return [];
  return withBlockNoteDom((editor) => editor.tryParseMarkdownToBlocks(markdown));
}

/**
 * Parse markdown and encode it as a Yjs document update (V1 `encodeStateAsUpdate`)
 * bound to the given fragment — the cold-start snapshot a collaborative doc
 * hydrates from. Returns `null` when there's nothing to seed (blank markdown or
 * zero blocks), so callers can skip storing an empty blob.
 *
 * `fragment` defaults to `"document-store"`, the XML fragment every Ripple
 * collaborative editor binds to.
 */
export async function markdownToYjsUpdate(
  markdown: string,
  fragment = "document-store",
): Promise<Uint8Array | null> {
  if (markdown.trim().length === 0) return null;
  return withBlockNoteDom(async (editor) => {
    const blocks = await editor.tryParseMarkdownToBlocks(markdown);
    if (blocks.length === 0) return null;
    const ydoc = blocksToYDoc(editor, blocks, fragment);
    return Y.encodeStateAsUpdate(ydoc);
  });
}
