// A real IndexedDB, so "after a reload" means what it says.
import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueryCacheMemory, saveCachedQuery } from "@/lib/query-cache";
import { useCachedQuery } from "./use-cached-query";

/**
 * The sidebar and the list pages are the answers to a few workspace-scoped
 * queries, and offline those never answer. This hook keeps the last answer
 * on the device and serves it, flagged as not live, until the server speaks.
 */

const server = vi.hoisted((): { answer: unknown } => ({ answer: undefined }));

vi.mock("convex-helpers/react/cache", () => ({
  useQuery: () => server.answer,
}));

const sidebar = makeFunctionReference<"query", { workspaceId: string }, string[]>(
  "workspaceSidebarData:get",
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  server.answer = undefined;
  clearQueryCacheMemory();
});

describe("useCachedQuery", () => {
  it("prefers the live answer whenever the query has one", async () => {
    saveCachedQuery('workspaceSidebarData:get|{"workspaceId":"ws-live"}', ["stale"]);
    server.answer = ["fresh"];

    const { result } = renderHook(() => useCachedQuery(sidebar, { workspaceId: "ws-live" }));

    expect(result.current).toEqual({ value: ["fresh"], isLive: true });
    await waitFor(() => expect(result.current.value).toEqual(["fresh"]));
  });

  it("serves the answer kept on this device while the query has none", async () => {
    saveCachedQuery('workspaceSidebarData:get|{"workspaceId":"ws-kept"}', ["general"]);
    await flush();
    clearQueryCacheMemory(); // a reload

    const { result } = renderHook(() => useCachedQuery(sidebar, { workspaceId: "ws-kept" }));

    expect(result.current).toEqual({ value: undefined, isLive: false });
    await waitFor(() => expect(result.current.value).toEqual(["general"]));
    expect(result.current.isLive).toBe(false);
  });

  it("keeps each live answer for the next visit", async () => {
    server.answer = ["kept-for-later"];
    renderHook(() => useCachedQuery(sidebar, { workspaceId: "ws-save" }));
    await flush();
    clearQueryCacheMemory(); // a reload
    server.answer = undefined; // ...with no network

    const { result } = renderHook(() => useCachedQuery(sidebar, { workspaceId: "ws-save" }));

    await waitFor(() => expect(result.current.value).toEqual(["kept-for-later"]));
  });

  it("keeps nothing and serves nothing for a skipped query", async () => {
    const { result } = renderHook(() => useCachedQuery(sidebar, "skip"));

    expect(result.current).toEqual({ value: undefined, isLive: false });
    await flush();
    expect(result.current).toEqual({ value: undefined, isLive: false });
  });

  it("never shows one workspace's copy under another workspace's key", async () => {
    saveCachedQuery('workspaceSidebarData:get|{"workspaceId":"ws-a"}', ["a-only"]);
    await flush();

    const { result, rerender } = renderHook(
      ({ workspaceId }) => useCachedQuery(sidebar, { workspaceId }),
      { initialProps: { workspaceId: "ws-a" } },
    );
    await waitFor(() => expect(result.current.value).toEqual(["a-only"]));

    rerender({ workspaceId: "ws-b" });

    expect(result.current.value).toBeUndefined();
    await flush();
    expect(result.current.value).toBeUndefined();
  });

  it("treats a live null as the server's answer, not as nothing", async () => {
    saveCachedQuery('workspaceSidebarData:get|{"workspaceId":"ws-gone"}', ["was-here"]);
    server.answer = null;

    const { result } = renderHook(() => useCachedQuery(sidebar, { workspaceId: "ws-gone" }));

    expect(result.current).toEqual({ value: null, isLive: true });
    await flush();
    expect(result.current).toEqual({ value: null, isLive: true });
  });
});
