import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { collabRoom } from "@/lib/collab/room";
import {
  contentUpdate,
  convexQuery,
  FakeProvider,
  persistenceInstances,
  resetCollabFakes,
  seedCache,
} from "@/test/collab-fakes";
import type { CollabSession } from "./use-collaborative-doc";
import { useCollaborativeDoc } from "./use-collaborative-doc";

// The provider, the IndexedDB database and Convex all come from the shared
// fakes — see `@/test/collab-fakes`. `vi.mock`'s async factory runs late
// enough to import a real module, so there is no hoisted block here.
vi.mock("y-partyserver/provider", async () => ({
  default: (await import("@/test/collab-fakes")).FakeProvider,
}));
vi.mock("y-indexeddb", async () => ({
  IndexeddbPersistence: (await import("@/test/collab-fakes")).FakeIndexeddbPersistence,
}));
vi.mock("convex/react", async () => {
  const { convexQuery: query } = await import("@/test/collab-fakes");
  return { useConvex: () => ({ query }) };
});

function memberSession(overrides: Partial<CollabSession> = {}): CollabSession {
  const room = collabRoom("doc", "abc123");
  return {
    key: room.roomId,
    room,
    mint: vi.fn(async () => ({ token: "token-1", roomId: room.roomId })),
    ...overrides,
  };
}

beforeEach(() => {
  resetCollabFakes();
  // The token cache is module state, including an in-flight map. A test that
  // leaves a request pending would otherwise hand that same promise to the
  // next test asking for the same room.
  clearCollaborationTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCollaborativeDoc", () => {
  it("connects to the room named by the session and reports live once synced", async () => {
    const session = memberSession();
    const { result } = renderHook(() => useCollaborativeDoc({ session }));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    const provider = FakeProvider.instances[0];
    expect(provider.room).toBe("doc-abc123");

    provider.connectAndSync();

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isOffline).toBe(false);
  });

  /**
   * Regression: the guest hook listed `isConnected` in its connection effect's
   * dependencies, so every status flip tore the provider down and rebuilt it —
   * an extra socket and token on first connect, and a forced recreation on
   * every blip that defeated y-partyserver's own backoff.
   */
  it("keeps a single provider across connection status changes", async () => {
    const session = memberSession();
    const { result } = renderHook(() => useCollaborativeDoc({ session }));

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    const provider = FakeProvider.instances[0];

    provider.connectAndSync();
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    // A network blip: the socket drops and y-partyserver reconnects it itself.
    provider.close();
    await waitFor(() => expect(result.current.isConnected).toBe(false));
    provider.connectAndSync();
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    expect(FakeProvider.instances).toHaveLength(1);
    expect(provider.destroyed).toBe(false);
    expect(session.mint).toHaveBeenCalledTimes(1);
  });

  it("retires its cursor and stops reconnecting when the caller unmounts", async () => {
    const { result, unmount } = renderHook(() =>
      useCollaborativeDoc({ session: memberSession() }),
    );

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    const provider = FakeProvider.instances[0];
    provider.connectAndSync();
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    provider.awareness.setLocalStateField("user", { name: "Ada" });
    unmount();

    // Peers must see the cursor go, not wait for it to time out.
    expect(provider.awareness.getLocalState()).toBeNull();
    expect(provider.shouldConnect).toBe(false);
    expect(provider.destroyed).toBe(true);
  });

  it("gives each room its own document, so switching never bleeds content", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => {
        const room = collabRoom("task", id);
        return useCollaborativeDoc({
          session: { key: room.roomId, room, mint: async () => ({ token: "t", roomId: room.roomId }) },
        });
      },
      { initialProps: { id: "task-one" } },
    );

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    const firstDoc = result.current.yDoc;
    firstDoc.getText("body").insert(0, "first task description");

    rerender({ id: "task-two" });

    await waitFor(() => expect(result.current.yDoc).not.toBe(firstDoc));
    expect(result.current.yDoc.getText("body").length).toBe(0);
    await waitFor(() => expect(FakeProvider.instances[1]?.room).toBe("task-task-two"));
  });

  it("caches a member's room offline, but never a guest's", async () => {
    const { unmount } = renderHook(() => useCollaborativeDoc({ session: memberSession() }));
    await waitFor(() => expect(persistenceInstances).toHaveLength(1));
    expect(persistenceInstances[0].name).toBe("doc-abc123");
    unmount();
    expect(persistenceInstances[0].destroyed).toBe(true);

    persistenceInstances.length = 0;

    // A guest's session resolves its room server-side and carries none, so a
    // revoked share link leaves nothing behind on the device.
    renderHook(() =>
      useCollaborativeDoc({
        session: {
          key: "guest:share-1:sub:Ada",
          room: null,
          mint: async () => ({ token: "t", roomId: "doc-abc123" }),
        },
      }),
    );
    await waitFor(() => expect(FakeProvider.instances.length).toBeGreaterThan(0));
    expect(persistenceInstances).toHaveLength(0);
  });

  it("stops loading as soon as the offline cache has something to show", async () => {
    seedCache("doc-abc123", contentUpdate("cached from a previous visit"));

    const { result } = renderHook(() =>
      useCollaborativeDoc({
        session: memberSession({
          // A server we never reach: only the cache can end the wait.
          mint: () => new Promise(() => {}),
        }),
      }),
    );

    await waitFor(() => expect(result.current.isCacheLoaded).toBe(true));
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isConnected).toBe(false);
  });

  /**
   * The distinction the whole reconciliation story rests on. A Y.Doc cannot
   * say "I don't know what is in this document" — it can only be empty — so
   * the hook has to carry that fact alongside it, or an editor will happily
   * let someone author into a document whose contents it has never seen.
   */
  describe("knowing whether we actually hold the document", () => {
    it("is not hydrated by an offline cache that replayed nothing", async () => {
      const { result } = renderHook(() =>
        useCollaborativeDoc({
          session: memberSession({ mint: () => new Promise(() => {}) }),
        }),
      );

      await waitFor(() => expect(result.current.isCacheLoaded).toBe(true));
      // The cache is loaded and the document is empty — but empty here means
      // "this device has never opened it", not "it has no content".
      expect(result.current.isHydrated).toBe(false);
      expect(result.current.isLoading).toBe(true);
    });

    it("is hydrated by a sync, even one that delivers an empty document", async () => {
      const { result } = renderHook(() =>
        useCollaborativeDoc({ session: memberSession() }),
      );

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      expect(result.current.isHydrated).toBe(false);

      FakeProvider.instances[0].connectAndSync();

      // Nothing was added to the document, yet we now know it is empty —
      // which is what makes it safe to edit.
      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      expect(result.current.yDoc.getText("body").length).toBe(0);
    });

    it("stays hydrated once the connection drops", async () => {
      const { result } = renderHook(() =>
        useCollaborativeDoc({ session: memberSession() }),
      );

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      FakeProvider.instances[0].connectAndSync();
      await waitFor(() => expect(result.current.isHydrated).toBe(true));

      FakeProvider.instances[0].close();

      await waitFor(() => expect(result.current.isConnected).toBe(false));
      // Losing the socket does not take back what the room already told us.
      expect(result.current.isHydrated).toBe(true);
    });

    it("starts over when a different room is opened", async () => {
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => {
          const room = collabRoom("doc", id);
          return useCollaborativeDoc({
            session: {
              key: room.roomId,
              room,
              mint: async () => ({ token: "t", roomId: room.roomId }),
            },
          });
        },
        { initialProps: { id: "first" } },
      );

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      FakeProvider.instances[0].connectAndSync();
      await waitFor(() => expect(result.current.isHydrated).toBe(true));

      rerender({ id: "second" });

      // Having synced one document says nothing about the next one.
      await waitFor(() => expect(result.current.isHydrated).toBe(false));
    });
  });

  describe("when the room is unreachable but Convex is not", () => {
    const snapshotUrl = "https://storage.example/snapshot";

    it("hydrates from the stored snapshot instead of pretending the document is empty", async () => {
      convexQuery.mockResolvedValue({ status: "stored", url: snapshotUrl });
      const stored = contentUpdate("what the server last persisted");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          expect(url).toBe(snapshotUrl);
          return { arrayBuffer: async () => stored.buffer.slice(0) } as Response;
        }),
      );

      const { result } = renderHook(() =>
        useCollaborativeDoc({
          // Minting fails, so the provider gives up and reports offline —
          // the collaboration server is down, the network is not.
          session: memberSession({ mint: () => Promise.reject(new Error("no")) }),
        }),
      );

      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      expect(result.current.yDoc.getText("body").toJSON()).toBe(
        "what the server last persisted",
      );
      expect(convexQuery).toHaveBeenCalledWith(expect.anything(), {
        resourceType: "doc",
        resourceId: "abc123",
      });
      vi.unstubAllGlobals();
    });

    /**
     * "Nothing has ever been stored for this resource" is an answer, not a
     * failure to get one: no snapshot means nobody has ever put content in,
     * because every client that opens an empty document writes the canonical
     * empty root into it. Reading that as unavailable is what made a
     * brand-new document report itself missing whenever the room was slow.
     */
    it("treats a confirmed absence of stored state as knowing the document is empty", async () => {
      convexQuery.mockResolvedValue({ status: "empty" });
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() =>
        useCollaborativeDoc({
          session: memberSession({ mint: () => Promise.reject(new Error("no")) }),
        }),
      );

      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      // There was nothing to download, and we did not try.
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    /**
     * The reason the client cannot infer "empty" from a bare null. A caller
     * who has lost access would otherwise bootstrap a document they can never
     * sync, and merge a competing root into it the day access came back.
     */
    it("stays unhydrated when Convex cannot say what is stored", async () => {
      convexQuery.mockResolvedValue({ status: "unavailable" });

      const { result } = renderHook(() =>
        useCollaborativeDoc({
          session: memberSession({ mint: () => Promise.reject(new Error("no")) }),
        }),
      );

      await waitFor(() => expect(result.current.isOffline).toBe(true));
      await waitFor(() => expect(convexQuery).toHaveBeenCalled());
      expect(result.current.isHydrated).toBe(false);
    });

    it("never asks for a guest's snapshot — a guest session carries no room", async () => {
      const { result } = renderHook(() =>
        useCollaborativeDoc({
          session: {
            key: "guest:share-1:sub:Ada",
            room: null,
            mint: () => Promise.reject(new Error("no")),
          },
        }),
      );

      await waitFor(() => expect(result.current.isOffline).toBe(true));
      expect(convexQuery).not.toHaveBeenCalled();
      expect(result.current.isHydrated).toBe(false);
    });
  });

  describe("when the server refuses the connection", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("rebuilds with a freshly minted token after backing off", async () => {
      const session = memberSession();
      renderHook(() => useCollaborativeDoc({ session }));
      await act(async () => {});

      const first = FakeProvider.instances[0];
      act(() => {
        first.open();
        first.send({ type: "auth_error", code: "UNAUTHORIZED" });
      });

      expect(first.destroyed).toBe(true);
      // Backing off is the point — no immediate retry.
      expect(FakeProvider.instances).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(FakeProvider.instances).toHaveLength(2);
      expect(session.mint).toHaveBeenCalledTimes(2);
    });

    it("stays down when access is revoked rather than retrying a closed door", async () => {
      const session = memberSession();
      const { result } = renderHook(() => useCollaborativeDoc({ session }));
      await act(async () => {});

      const provider = FakeProvider.instances[0];
      act(() => {
        provider.open();
        provider.send({ type: "permission_revoked", reason: "removed from workspace" });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(FakeProvider.instances).toHaveLength(1);
      expect(session.mint).toHaveBeenCalledTimes(1);
      expect(result.current.provider).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOffline).toBe(true);
    });

    it("connects normally to the next room opened after a revoked one", async () => {
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => {
          const room = collabRoom("doc", id);
          return useCollaborativeDoc({
            session: {
              key: room.roomId,
              room,
              mint: async () => ({ token: "t", roomId: room.roomId }),
            },
          });
        },
        { initialProps: { id: "revoked-doc" } },
      );
      await act(async () => {});

      act(() => {
        FakeProvider.instances[0].open();
        FakeProvider.instances[0].send({ type: "permission_revoked", reason: "nope" });
      });

      rerender({ id: "another-doc" });
      await act(async () => {});

      // The refusal belonged to the old room, not to this hook.
      const latest = FakeProvider.instances.at(-1);
      expect(latest?.room).toBe("doc-another-doc");
      expect(latest?.destroyed).toBe(false);

      act(() => latest?.connectAndSync());
      expect(result.current.isConnected).toBe(true);
      expect(result.current.isOffline).toBe(false);
    });
  });
});
