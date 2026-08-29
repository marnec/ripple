import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockNoteEditor } from "@blocknote/core";
import { exportDocumentDocx } from "./document";
import { parseBlocks } from "./parse";
import { NULL_EXPORT_CONTEXT } from "./types";
import type { ExportContext, ImageEmbed, IncomingBlock } from "./types";

// `./embeds` pulls Excalidraw in for diagram rendering, and with it a JSON
// import vite-node will not load. The image embeds here are supplied directly.
vi.mock("./embeds", () => ({
  fetchCellGrid: async () => new Map(),
  resolveDiagramEmbed: async () => undefined,
  resolveImageEmbed: async () => undefined,
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

const IMAGE_URL = "https://files.test/cat.png";

/** Bytes never leave `ImageRun` — docx does not decode them — so any payload
 *  distinguishable in the zip will do. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function contextWith(embed: ImageEmbed | undefined): ExportContext {
  return { ...NULL_EXPORT_CONTEXT, image: (url) => (url === IMAGE_URL ? embed : undefined) };
}

function fakeEditor(blocks: IncomingBlock[]) {
  return { document: blocks } as unknown as BlockNoteEditor<any, any, any>;
}

async function exportedDocx(
  blocks: IncomingBlock[],
  ctx: ExportContext,
): Promise<Map<string, Buffer>> {
  await exportDocumentDocx(fakeEditor(blocks), "doc", ctx);
  expect(downloads).toHaveLength(1);
  return unzip(Buffer.from(await downloads[0].arrayBuffer()));
}

/** Minimal reader over the .docx package: walk the central directory, inflate
 *  each entry. Enough to assert what actually landed in the file. */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");

  const entries = new Map<string, Buffer>();
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    const local = buf.readUInt32LE(offset + 42);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? data : inflateRawSync(data));
    offset += 46 + nameLength + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return entries;
}

describe("image blocks in the export AST", () => {
  it("carries the URL, caption and author's preview width", () => {
    expect(
      parseBlocks([
        {
          type: "image",
          props: { url: IMAGE_URL, caption: "A cat", previewWidth: 320 },
        },
      ]),
    ).toEqual([{ kind: "image", url: IMAGE_URL, caption: "A cat", previewWidth: 320 }]);
  });

  it("leaves previewWidth unset when BlockNote wrote no usable value", () => {
    expect(
      parseBlocks([{ type: "image", props: { url: IMAGE_URL, previewWidth: 0 } }]),
    ).toMatchObject([{ kind: "image", previewWidth: undefined }]);
  });
});

describe("image DOCX export", () => {
  const embed: ImageEmbed = { bytes: PNG_BYTES, type: "png", width: 800, height: 400 };

  it("embeds the picture itself, not a placeholder line", async () => {
    const files = await exportedDocx(
      [{ type: "image", props: { url: IMAGE_URL, caption: "A cat" } }],
      contextWith(embed),
    );

    // The zip carries a `word/media/` directory entry too — only real files count.
    const media = [...files].filter(([name]) => /^word\/media\/.+/.test(name));
    expect(media).toHaveLength(1);
    expect(Uint8Array.from(media[0][1])).toEqual(PNG_BYTES);

    const xml = files.get("word/document.xml")!.toString("utf8");
    expect(xml).toContain("<w:drawing>");
    expect(xml).not.toContain("[image]");
    // The caption survives as its own paragraph.
    expect(xml).toContain("A cat");
  });

  it("scales to the author's preview width, keeping the aspect ratio", async () => {
    const files = await exportedDocx(
      [{ type: "image", props: { url: IMAGE_URL, previewWidth: 300 } }],
      contextWith(embed),
    );

    // docx works in EMU: 1px = 9525 EMU. 300px wide at 800×400 is 150px tall.
    const xml = files.get("word/document.xml")!.toString("utf8");
    expect(xml).toContain(`cx="${300 * 9525}" cy="${150 * 9525}"`);
  });

  it("caps a wider image at the printable page width", async () => {
    const files = await exportedDocx(
      [{ type: "image", props: { url: IMAGE_URL } }],
      contextWith(embed),
    );

    // 800px intrinsic clamps to 576px (~6in at 96 DPI), so 288px tall.
    const xml = files.get("word/document.xml")!.toString("utf8");
    expect(xml).toContain(`cx="${576 * 9525}" cy="${288 * 9525}"`);
  });

  it("falls back to a caption line when the image could not be read", async () => {
    const files = await exportedDocx(
      [{ type: "image", props: { url: IMAGE_URL, caption: "A cat" } }],
      contextWith(undefined),
    );

    expect([...files.keys()].some((name) => /^word\/media\/.+/.test(name))).toBe(false);
    expect(files.get("word/document.xml")!.toString("utf8")).toContain("A cat");
  });
});
