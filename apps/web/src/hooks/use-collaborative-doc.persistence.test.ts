// A real IndexedDB, not the shared fake the sibling test files use.
import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { collabRoom } from "@/lib/collab/room";
import { resetCollabFakes } from "@/test/collab-fakes";
import { useCollaborativeDoc, type CollabSession } from "./use-collaborative-doc";

/**
 * The room store rides inside the same IndexedDB database as the room's Yjs
 * cache, in the `custom` object store y-indexeddb creates and never uses
 * itself. That is the premise of the whole design, so these tests drive the
 * real persistence rather than a stand-in: if y-indexeddb ever stops creating
 * that store, this file fails instead of the cache quietly doing nothing.
 *
 * Only the provider and Convex are faked here — deliberately not `y-indexeddb`.
 */

vi.mock("y-partyserver/provider", async () => ({
  default: (await import("@/test/collab-fakes")).FakeProvider,
}));
vi.mock("convex/react", async () => {
  const { convexQuery: query } = await import("@/test/collab-fakes");
  return { useConvex: () => ({ query }) };
});

function memberSession(resourceId: string): CollabSession {
  const room = collabRoom("doc", resourceId);
  return {
    key: room.roomId,
    room,
    mint: async () => ({ token: "t", roomId: room.roomId }),
  };
}

beforeEach(() => {
  resetCollabFakes();
  clearCollaborationTokenCache();
});

describe("the room store", () => {
  it("round-trips a value in the room's own database", async () => {
    const { result } = renderHook(() =>
      useCollaborativeDoc({ session: memberSession("round-trip") }),
    );

    await waitFor(() => expect(result.current.roomStore).not.toBeNull());
    await result.current.roomStore!.set("meta", { name: "Quarterly plan" });

    await expect(result.current.roomStore!.get("meta")).resolves.toEqual({
      name: "Quarterly plan",
    });
  });

  it("reports nothing for a key it has never been given", async () => {
    const { result } = renderHook(() =>
      useCollaborativeDoc({ session: memberSession("never-written") }),
    );

    await waitFor(() => expect(result.current.roomStore).not.toBeNull());
    await expect(result.current.roomStore!.get("meta")).resolves.toBeNull();
  });

  it("keeps each room's values to itself", async () => {
    const first = renderHook(() =>
      useCollaborativeDoc({ session: memberSession("room-one") }),
    );
    await waitFor(() => expect(first.result.current.roomStore).not.toBeNull());
    await first.result.current.roomStore!.set("meta", { name: "First" });

    const second = renderHook(() =>
      useCollaborativeDoc({ session: memberSession("room-two") }),
    );
    await waitFor(() => expect(second.result.current.roomStore).not.toBeNull());

    // Separate databases, because the store is named after the room.
    await expect(second.result.current.roomStore!.get("meta")).resolves.toBeNull();
  });

  /**
   * A guest's device deliberately keeps no cache of a link that can be revoked.
   * Whatever we learn about the resource has to go the same way as its content.
   */
  it("gives a guest no store at all", async () => {
    const { result } = renderHook(() =>
      useCollaborativeDoc({
        session: {
          key: "guest:share-1:sub:Ada",
          room: null,
          mint: async () => ({ token: "t", roomId: "doc-shared" }),
        },
      }),
    );

    await waitFor(() => expect(result.current.yDoc).toBeDefined());
    expect(result.current.roomStore).toBeNull();
  });

  it("answers harmlessly once the room has been torn down", async () => {
    const { result, unmount } = renderHook(() =>
      useCollaborativeDoc({ session: memberSession("torn-down") }),
    );
    await waitFor(() => expect(result.current.roomStore).not.toBeNull());
    const store = result.current.roomStore!;
    await store.set("meta", { name: "Written before unmount" });

    unmount();

    // A page that unmounts mid-write must not surface an exception.
    await expect(store.set("meta", { name: "After" })).resolves.toBeUndefined();
    await expect(store.get("meta")).resolves.toBeNull();
  });
});
