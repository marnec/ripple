import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearEmbedPreviewMemory,
  loadEmbedPreview,
  saveEmbedPreview,
} from "@/lib/embed-preview-cache";
import { useEmbedPreview } from "./use-embed-preview";

/**
 * The contract an embed depends on: something to render before the server has
 * answered, the server's answer the moment it arrives, and never one embed's
 * content shown under another embed's key.
 */

beforeEach(() => {
  clearEmbedPreviewMemory();
});

describe("useEmbedPreview", () => {
  it("has nothing before either source answers", () => {
    const { result } = renderHook(() => useEmbedPreview("k1", undefined));

    expect(result.current).toBeUndefined();
  });

  it("paints the stored copy while the query is still out", async () => {
    saveEmbedPreview("k2", { text: "stored" });
    clearEmbedPreviewMemory();

    const { result } = renderHook(() => useEmbedPreview("k2", undefined));

    await waitFor(() => expect(result.current).toEqual({ text: "stored" }));
  });

  it("prefers the server's answer over the stored copy", async () => {
    saveEmbedPreview("k3", { text: "stored" });
    clearEmbedPreviewMemory();

    const { result } = renderHook(() => useEmbedPreview("k3", { text: "live" }));

    expect(result.current).toEqual({ text: "live" });
  });

  it("keeps every answer for the next page load", async () => {
    renderHook(() => useEmbedPreview("k4", { text: "live" }));

    await waitFor(async () => {
      clearEmbedPreviewMemory();
      await expect(loadEmbedPreview("k4")).resolves.toEqual({ text: "live" });
    });
  });

  it("keeps showing the copy when the projection row is missing", async () => {
    // `null` here means "nothing has been projected yet" — the moment just
    // after an embed is inserted — not "this embed has no content".
    saveEmbedPreview("k5", { text: "stored" });

    const { result } = renderHook(() => useEmbedPreview("k5", null));

    await waitFor(() => expect(result.current).toEqual({ text: "stored" }));
  });

  it("never shows one embed's content under another's key", async () => {
    saveEmbedPreview("k6", { text: "six" });

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useEmbedPreview(key, undefined),
      { initialProps: { key: "k6" } },
    );
    await waitFor(() => expect(result.current).toEqual({ text: "six" }));

    rerender({ key: "k7" });
    expect(result.current).toBeUndefined();
  });
});
