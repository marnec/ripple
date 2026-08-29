import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockNoteEditor } from "@blocknote/core";
import { exportDocumentMarkdown } from "./document";
import { parseBlocks } from "./parse";
import type { IncomingBlock } from "./types";

// `./embeds` pulls Excalidraw in for diagram rendering, and with it a JSON
// import vite-node will not load. Nothing here exports a diagram.
vi.mock("./embeds", () => ({
  fetchCellGrid: async () => new Map(),
  resolveDiagramEmbed: async () => undefined,
}));

const downloads: Blob[] = [];
vi.mock("@/lib/download-blob", () => ({
  sanitizeFilename: (name: string) => name,
  triggerDownload: (blob: Blob) => {
    downloads.push(blob);
  },
}));

beforeEach(() => {
  downloads.length = 0;
});

/** The exporters only ever read `editor.document`. */
function fakeEditor(blocks: IncomingBlock[]) {
  return { document: blocks } as unknown as BlockNoteEditor<any, any, any>;
}

async function exportedMarkdown(blocks: IncomingBlock[]): Promise<string> {
  exportDocumentMarkdown(fakeEditor(blocks), "doc");
  expect(downloads).toHaveLength(1);
  return downloads[0].text();
}

describe("math in the export AST", () => {
  it("parses a math block's LaTeX source", () => {
    expect(parseBlocks([{ type: "mathBlock", content: "a^2 = b^2 + c^2" }])).toEqual([
      { kind: "mathBlock", latex: "a^2 = b^2 + c^2" },
    ]);
  });

  it("parses inline math inside a paragraph", () => {
    const [paragraph] = parseBlocks([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Euler: ", styles: {} },
          { type: "math", content: "e^{i\\pi} + 1 = 0" },
        ],
      },
    ]);
    expect(paragraph).toMatchObject({
      kind: "paragraph",
      content: [
        { kind: "text", text: "Euler: " },
        { kind: "math", latex: "e^{i\\pi} + 1 = 0" },
      ],
    });
  });

  it("keeps LaTeX intact when the source arrives as styled inlines", () => {
    // BlockNote's "plain" content is a bare string in the document JSON, but
    // the editor can hand it over as inline runs — both shapes must survive.
    expect(
      parseBlocks([
        {
          type: "mathBlock",
          content: [
            { type: "text", text: "\\int_0^\\infty ", styles: {} },
            { type: "text", text: "e^{-x^2} dx", styles: {} },
          ],
        },
      ]),
    ).toEqual([{ kind: "mathBlock", latex: "\\int_0^\\infty e^{-x^2} dx" }]);
  });
});

describe("math markdown export", () => {
  it("writes a math block as a $$ fence", async () => {
    const md = await exportedMarkdown([{ type: "mathBlock", content: "a^2 = b^2" }]);
    expect(md).toBe("$$\na^2 = b^2\n$$\n\n");
  });

  it("writes inline math as $…$ without escaping the LaTeX", async () => {
    // The markdown escaper would turn `\`, `{` and `_` into something no math
    // renderer accepts — inline math has to bypass it.
    const md = await exportedMarkdown([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "so ", styles: {} },
          { type: "math", content: "x_{1} \\neq y" },
        ],
      },
    ]);
    expect(md).toBe("so $x_{1} \\neq y$\n\n");
  });
});
