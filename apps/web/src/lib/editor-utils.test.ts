import { describe, expect, it } from "vitest";
import { blocksToPlainText, parseCommentBody } from "./editor-utils";

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

const NO_NAMES = new Map<string, string>();

/** A `table` block in the `tableCell` shape the editor actually produces. */
const tableBlock = (rows: string[][]) => ({
  type: "table",
  content: {
    type: "tableContent",
    rows: rows.map((cells) => ({
      cells: cells.map((text) => ({
        type: "tableCell",
        props: {},
        content: [{ type: "text", text, styles: {} }],
      })),
    })),
  },
});

describe("blocksToPlainText — the search projection", () => {
  it("flattens table cells so a frozen range can be found by its numbers", () => {
    const text = blocksToPlainText(
      [tableBlock([["Q3", "Q4"], ["1200", "1450"]])],
      NO_NAMES,
      NO_NAMES,
    );
    expect(text).toBe("Q3 | Q4\n1200 | 1450");
  });

  it("flattens the bare cell shape older bodies carry", () => {
    const legacy = {
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: [[{ type: "text", text: "legacy", styles: {} }]] }],
      },
    };
    expect(blocksToPlainText([legacy], NO_NAMES, NO_NAMES)).toBe("legacy");
  });

  it("states the range on a resourceReference that heads a frozen table", () => {
    const text = blocksToPlainText(
      [
        {
          type: "paragraph",
          content: [
            {
              type: "resourceReference",
              props: {
                resourceId: "s1",
                resourceType: "spreadsheet",
                resourceName: "Budget",
                cellRef: "B2:D5",
              },
            },
          ],
        },
      ],
      NO_NAMES,
      NO_NAMES,
    );
    expect(text).toBe("#Budget \u203A B2:D5");
  });

  it("leaves a chip without a range exactly as it was", () => {
    const text = blocksToPlainText(
      [
        {
          type: "paragraph",
          content: [
            {
              type: "resourceReference",
              props: {
                resourceId: "s1",
                resourceType: "spreadsheet",
                resourceName: "Budget",
              },
            },
          ],
        },
      ],
      NO_NAMES,
      NO_NAMES,
    );
    expect(text).toBe("#Budget");
  });
});
