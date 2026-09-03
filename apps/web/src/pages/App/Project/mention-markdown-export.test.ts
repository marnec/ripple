import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { taskCommentSchema } from "./taskCommentSchema";

/**
 * The markdown posted alongside a task comment or a description is rendered in
 * the browser by `blocksToMarkdownLossy`. Mentions are Ripple-only inline
 * content, so without an external-HTML export they vanish: "ping @Marco" left
 * the browser as "ping ". Each mention spec now exports a stable token the
 * dispatch layer rewrites server-side (`integrations/core/mentionTokens.ts`).
 * The token has no markdown-special characters, so it survives the HTML →
 * markdown pass unescaped.
 */
function editorWith(inline: Record<string, unknown>) {
  const editor = BlockNoteEditor.create({
    schema: taskCommentSchema,
    // React inline content exports through `renderToString` only on a headless
    // editor; a mounted one expects BlockNoteView's element renderer.
    _headless: true,
    initialContent: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "ping ", styles: {} },
          inline as never,
          { type: "text", text: " about this", styles: {} },
        ],
      },
    ],
  });
  return editor;
}

describe("mention markdown export", () => {
  it("exports a user mention as an @user:<id> token, never as empty text", () => {
    const editor = editorWith({ type: "userMention", props: { userId: "k17abc" } });
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown.trim()).toBe("ping @user:k17abc about this");
  });
});

describe("event mention markdown export", () => {
  it("exports an event mention as an @event:<id> token", () => {
    const editor = editorWith({ type: "eventMention", props: { eventId: "k17evt", seriesId: "" } });
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown.trim()).toBe("ping @event:k17evt about this");
  });

  it("exports a series mention as an @series:<id> token", () => {
    const editor = editorWith({ type: "eventMention", props: { eventId: "", seriesId: "k17ser" } });
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown.trim()).toBe("ping @series:k17ser about this");
  });

  it("exports a mention with no target as a visible unknown marker", () => {
    const editor = editorWith({ type: "userMention", props: { userId: "" } });
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown.trim()).toBe("ping @unknown-user about this");
  });
});
