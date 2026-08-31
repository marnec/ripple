// A real IndexedDB — the whole point of this module is what survives a reload.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  blockPreviewKey,
  cellPreviewKey,
  clearEmbedPreviewMemory,
  loadEmbedPreview,
  readEmbedPreviewSync,
  saveEmbedPreview,
  seedBlockPreview,
  seedCellPreview,
} from "./embed-preview-cache";

/**
 * Clearing the in-memory mirror is how a test says "a new page load": the
 * IndexedDB database persists across it, exactly as a browser's would.
 */
beforeEach(() => {
  clearEmbedPreviewMemory();
});

describe("embed preview cache", () => {
  it("reads back a saved value on the next load", async () => {
    saveEmbedPreview("cell:a:b", { values: [["42"]] });
    clearEmbedPreviewMemory();

    await expect(loadEmbedPreview("cell:a:b")).resolves.toEqual({
      values: [["42"]],
    });
  });

  it("answers synchronously once this session has seen the key", async () => {
    saveEmbedPreview("cell:a:b", { values: [["42"]] });
    clearEmbedPreviewMemory();
    // The async read is what populates the mirror.
    await loadEmbedPreview("cell:a:b");

    expect(readEmbedPreviewSync("cell:a:b")).toEqual({ values: [["42"]] });
  });

  it("has nothing to say about a key it has never stored", async () => {
    expect(readEmbedPreviewSync("cell:never:seen")).toBeUndefined();
    await expect(loadEmbedPreview("cell:never:seen")).resolves.toBeNull();
  });

  it("replaces a stored value with a newer one", async () => {
    saveEmbedPreview("cell:a:b", { values: [["42"]] });
    saveEmbedPreview("cell:a:b", { values: [["43"]] });
    clearEmbedPreviewMemory();

    await expect(loadEmbedPreview("cell:a:b")).resolves.toEqual({
      values: [["43"]],
    });
  });

  it("seeds a cell embed with what the picker was showing", () => {
    seedCellPreview("sheet1", "stable-1", "A1", [["42"]]);

    expect(readEmbedPreviewSync(cellPreviewKey("sheet1", "stable-1"))).toMatchObject({
      values: [["42"]],
      cellRef: "A1",
      stableRef: "stable-1",
      orphan: false,
    });
  });

  it("seeds a block embed with what the picker was showing", () => {
    seedBlockPreview("doc1", "block-1", "heading", "Quarterly goals");

    expect(readEmbedPreviewSync(blockPreviewKey("doc1", "block-1"))).toMatchObject({
      blockType: "heading",
      textContent: "Quarterly goals",
    });
  });

  it("keys embeds by the resource they point at", () => {
    seedCellPreview("sheet1", "stable-1", "A1", [["42"]]);
    seedCellPreview("sheet2", "stable-1", "A1", [["7"]]);

    expect(readEmbedPreviewSync(cellPreviewKey("sheet1", "stable-1"))).toMatchObject({
      values: [["42"]],
    });
    expect(readEmbedPreviewSync(cellPreviewKey("sheet2", "stable-1"))).toMatchObject({
      values: [["7"]],
    });
  });
});
