import { describe, expect, it } from "vitest";
import { parseCommentBody } from "./editor-utils";

describe("parseCommentBody", () => {
  it("parses BlockNote JSON bodies as-is", () => {
    const blocks = [
      { id: "1", type: "paragraph", content: [{ type: "text", text: "hi", styles: {} }] },
    ];
    expect(parseCommentBody(JSON.stringify(blocks))).toEqual(blocks);
  });

  it("wraps plain-text bodies as a text inline node, not a bare string", () => {
    // GitHub-synced comments arrive as plain markdown text, not BlockNote JSON.
    // BlockNoteRenderer only renders `content` when it's an array of inline
    // nodes, so a bare string would render as nothing (empty comment bug).
    const result = parseCommentBody("Hello from GitHub");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Hello from GitHub", styles: {} }],
    });
  });
});
