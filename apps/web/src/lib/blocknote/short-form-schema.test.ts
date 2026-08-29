import { describe, expect, it } from "vitest";
import { defaultBlockSpecs } from "@blocknote/core";
import { shortFormBlockSpecs } from "./short-form-schema";
import { documentCommentSchema } from "@/pages/App/Document/comment-schema";
import { taskCommentSchema } from "@/pages/App/Project/taskCommentSchema";

/** Nothing a person can attach may be authorable in a short-form composer. */
const MEDIA_BLOCKS = ["file", "audio", "video", "image"] as const;

/**
 * Blocks and inline content that pull another resource into the body. Comments
 * must not be able to reach any of them — a comment is about the thing it is
 * attached to, not a place to assemble content from elsewhere.
 */
const EMBED_SPECS = [
  "diagram",
  "diagramEmbed",
  "spreadsheetRange",
  "spreadsheetLink",
  "spreadsheetCellRef",
  "documentBlockEmbed",
  "documentLink",
  "resourceReference",
  "projectReference",
] as const;

describe("shortFormBlockSpecs", () => {
  it("drops every media block and headings", () => {
    const specs = Object.keys(shortFormBlockSpecs());
    for (const media of MEDIA_BLOCKS) expect(specs).not.toContain(media);
    expect(specs).not.toContain("heading");
  });

  it("keeps the prose blocks that make up an ordinary message", () => {
    expect(Object.keys(shortFormBlockSpecs())).toEqual(
      expect.arrayContaining([
        "paragraph",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "quote",
        "codeBlock",
        "table",
      ]),
    );
  });

  it("removes exactly those five and nothing else", () => {
    const removed = Object.keys(defaultBlockSpecs).filter(
      (k) => !(k in shortFormBlockSpecs()),
    );
    expect(removed.sort()).toEqual(["audio", "file", "heading", "image", "video"]);
  });
});

describe.each([
  ["document comments", documentCommentSchema],
  ["task comments", taskCommentSchema],
])("%s", (_name, schema) => {
  const blocks = Object.keys(schema.blockSchema);
  const inline = Object.keys(schema.inlineContentSchema);

  it("cannot carry media", () => {
    for (const media of MEDIA_BLOCKS) expect(blocks).not.toContain(media);
  });

  it("cannot embed a document, spreadsheet or diagram", () => {
    for (const spec of EMBED_SPECS) {
      expect(blocks).not.toContain(spec);
      expect(inline).not.toContain(spec);
    }
  });

  it("still supports plain prose", () => {
    expect(blocks).toContain("paragraph");
    expect(blocks).toContain("bulletListItem");
  });
});
