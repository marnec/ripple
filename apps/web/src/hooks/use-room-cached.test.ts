import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoomStore } from "@/lib/collab/room-store";
import { useRoomCached } from "./use-room-cached";

/**
 * Convex metadata — a resource's name, its tags — is a separate round trip
 * from its collaborative content, and offline it is the round trip that never
 * comes back. This hook keeps the last answer beside the room's content so a
 * page has something truthful to render when the query cannot answer.
 */

/** A room store backed by a Map, standing in for one backed by IndexedDB. */
function fakeStore(initial: Record<string, unknown> = {}): RoomStore {
  const values = new Map(Object.entries(initial));
  return {
    get: <T,>(key: string) => Promise.resolve((values.get(key) ?? null) as T | null),
    set: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("useRoomCached", () => {
  it("prefers the live value whenever the query has answered", async () => {
    const store = fakeStore({ meta: { name: "Stale name" } });

    const { result } = renderHook(() =>
      useRoomCached(store, "meta", { name: "Live name" }),
    );

    expect(result.current).toEqual({ name: "Live name" });
    // Still true after the cached read has had a chance to land.
    await waitFor(() => expect(result.current).toEqual({ name: "Live name" }));
  });

  it("falls back to the stored value while the query has not answered", async () => {
    const store = fakeStore({ meta: { name: "From the last visit" } });

    const { result } = renderHook(() => useRoomCached(store, "meta", undefined));

    // Reading IndexedDB is asynchronous, so the first render has nothing —
    // reserved space, then content, which is how this app loads anyway.
    expect(result.current).toBeUndefined();
    await waitFor(() =>
      expect(result.current).toEqual({ name: "From the last visit" }),
    );
  });

  /**
   * `null` from Convex means the resource is gone, which is an answer — the
   * page renders its deleted state. Treating it as "no answer yet" would
   * resurrect a document from cache that nobody can open any more.
   */
  it("does not let a cached copy mask a resource that has been deleted", async () => {
    const store = fakeStore({ meta: { name: "Since deleted" } });

    const { result } = renderHook(() =>
      useRoomCached<{ name: string } | null>(store, "meta", null),
    );

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("stores each live answer, so the next visit has one to fall back on", async () => {
    const store = fakeStore();

    const { rerender } = renderHook(
      ({ live }: { live: { name: string } | undefined }) =>
        useRoomCached(store, "meta", live),
      { initialProps: { live: undefined as { name: string } | undefined } },
    );

    rerender({ live: { name: "Fresh from the server" } });

    await waitFor(async () =>
      expect(await store.get("meta")).toEqual({ name: "Fresh from the server" }),
    );
  });

  it("does not store the absence of a deleted resource as if it were content", async () => {
    const store = fakeStore();

    renderHook(() => useRoomCached<{ name: string } | null>(store, "meta", null));

    await waitFor(async () => expect(await store.get("meta")).toBeNull());
  });

  it("is a pass-through when the room keeps no store", async () => {
    const { result } = renderHook(() => useRoomCached(null, "meta", undefined));

    await waitFor(() => expect(result.current).toBeUndefined());
  });

  /**
   * The task detail sheet stays mounted while the task under it changes, so a
   * cached value has to belong to the room currently open. Showing the last
   * one until the new read lands puts one task's title on another.
   */
  it("never shows the previous room's value after switching rooms", async () => {
    const first = fakeStore({ meta: { name: "First room" } });
    const second = fakeStore({ meta: { name: "Second room" } });

    const { result, rerender } = renderHook(
      ({ store }: { store: RoomStore }) => useRoomCached(store, "meta", undefined),
      { initialProps: { store: first } },
    );
    await waitFor(() => expect(result.current).toEqual({ name: "First room" }));

    rerender({ store: second });

    expect(result.current).not.toEqual({ name: "First room" });
    await waitFor(() => expect(result.current).toEqual({ name: "Second room" }));
  });
});
