// A real IndexedDB — the whole point of this module is what survives a reload.
import "fake-indexeddb/auto";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQueryCache,
  clearQueryCacheMemory,
  forgetCachedQueries,
  loadCachedQuery,
  queryCacheKey,
  readCachedQuerySync,
  saveCachedQuery,
  stableStringify,
} from "./query-cache";

/**
 * Clearing the in-memory mirror is how a test says "a new page load": the
 * IndexedDB database persists across it, exactly as a browser's would.
 */
beforeEach(() => {
  clearQueryCacheMemory();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("query cache", () => {
  it("reads back a saved answer on the next load", async () => {
    saveCachedQuery("k:reload", { channels: [{ name: "general" }] });
    await flush();
    clearQueryCacheMemory();

    expect(readCachedQuerySync("k:reload")).toBeUndefined();
    await expect(loadCachedQuery("k:reload")).resolves.toEqual({
      channels: [{ name: "general" }],
    });
    // Loading is what primes the mirror for the next remount.
    expect(readCachedQuerySync("k:reload")).toEqual({ channels: [{ name: "general" }] });
  });

  it("answers null for a key nothing was ever kept under", async () => {
    await expect(loadCachedQuery("k:never")).resolves.toBeNull();
  });

  it("forgets only the rows whose key matches, in memory and on disk", async () => {
    saveCachedQuery("sidebar|{ws:A}", ["a"]);
    saveCachedQuery("sidebar|{ws:B}", ["b"]);
    await flush();

    await forgetCachedQueries((key) => key.includes("ws:A"));

    expect(readCachedQuerySync("sidebar|{ws:A}")).toBeUndefined();
    expect(readCachedQuerySync("sidebar|{ws:B}")).toEqual(["b"]);
    clearQueryCacheMemory();
    await expect(loadCachedQuery("sidebar|{ws:A}")).resolves.toBeNull();
    await expect(loadCachedQuery("sidebar|{ws:B}")).resolves.toEqual(["b"]);
  });

  it("clears everything when the session ends", async () => {
    saveCachedQuery("k:clear-1", 1);
    saveCachedQuery("k:clear-2", 2);
    await flush();

    await clearQueryCache();

    clearQueryCacheMemory();
    await expect(loadCachedQuery("k:clear-1")).resolves.toBeNull();
    await expect(loadCachedQuery("k:clear-2")).resolves.toBeNull();
  });
});

describe("queryCacheKey", () => {
  it("names the row after the function and its arguments", () => {
    const ref = makeFunctionReference<"query">("workspaceSidebarData:get");
    expect(queryCacheKey(ref, { workspaceId: "ws1" })).toBe(
      'workspaceSidebarData:get|{"workspaceId":"ws1"}',
    );
  });

  it("does not depend on key order or on absent optional arguments", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
    expect(stableStringify({ workspaceId: "x", searchText: undefined })).toBe(
      stableStringify({ workspaceId: "x" }),
    );
  });
});
