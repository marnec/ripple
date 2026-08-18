import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { useDocumentCollaboration, type DescriptionSeed } from "./use-document-collaboration";

/**
 * Whether a collaborative editor is handed to the caller at all.
 *
 * The rule under test is one line — no editor until the replica is hydrated —
 * but it is the line that decides whether a user can type into a document
 * whose contents nobody has told this device. `empty-document.test.ts` covers
 * what that typing would cost.
 */

const { FakeProvider, cache, convexQuery, mint } = vi.hoisted(() => {
  const cache = new Map<string, (doc: unknown) => void>();
  const convexQuery = vi.fn();
  /** How the collaboration token behaves. Tests can make it never arrive. */
  const mint = { run: async () => ({ token: "t", roomId: "doc-doc-1" }) };

  class FakeProvider {
    static instances: FakeProvider[] = [];
    shouldConnect = true;
    destroyed = false;
    ws = null;
    awareness: Awareness;
    private handlers = new Map<string, Set<(...args: never[]) => void>>();

    constructor(_host: string, _room: string, doc: Y.Doc) {
      this.awareness = new Awareness(doc);
      FakeProvider.instances.push(this);
    }
    on(event: string, handler: (...args: never[]) => void) {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: (...args: never[]) => void) {
      this.handlers.get(event)?.delete(handler);
    }
    destroy() {
      this.destroyed = true;
      this.awareness.destroy();
    }
    sync() {
      for (const handler of [...(this.handlers.get("sync") ?? [])]) {
        (handler as (synced: boolean) => void)(true);
      }
    }
  }

  return { FakeProvider, cache, convexQuery, mint };
});

vi.mock("y-partyserver/provider", () => ({ default: FakeProvider }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    private handlers: (() => void)[] = [];
    constructor(name: string, doc: unknown) {
      queueMicrotask(() => {
        cache.get(name)?.(doc);
        this.handlers.forEach((handler) => handler());
      });
    }
    on(event: string, handler: () => void) {
      if (event === "synced") this.handlers.push(handler);
    }
    destroy() {
      return Promise.resolve();
    }
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: convexQuery }),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useAction: () => () => mint.run(),
}));

const schema = BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs });

function render(options: {
  documentId?: string;
  resourceType?: "doc" | "task";
  seed?: DescriptionSeed;
} = {}) {
  return renderHook(() =>
    useDocumentCollaboration({
      documentId: options.documentId ?? "doc-1",
      userName: "Ada",
      userId: "user-1",
      schema,
      resourceType: options.resourceType ?? "doc",
      seed: options.seed,
    }),
  );
}

/** A cached copy of the document, as a previous visit would have left it. */
function cacheDocument(roomId: string, text: string) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
  const group = new Y.XmlElement("blockGroup");
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", "cached");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  container.insert(0, [paragraph]);
  group.insert(0, [container]);
  fragment.insert(0, [group]);
  const update = Y.encodeStateAsUpdate(doc);
  cache.set(roomId, (target) => Y.applyUpdate(target as Y.Doc, update));
}

beforeEach(() => {
  FakeProvider.instances.length = 0;
  cache.clear();
  convexQuery.mockReset();
  convexQuery.mockResolvedValue({ status: "unavailable" });
  mint.run = async () => ({ token: "t", roomId: "doc-doc-1" });
  clearCollaborationTokenCache();
});

describe("useDocumentCollaboration", () => {
  it("hands over an editor once the room has answered", async () => {
    const { result } = render();

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    expect(result.current.editor).toBeNull();

    FakeProvider.instances[0].sync();

    await waitFor(() => expect(result.current.editor).not.toBeNull());
    expect(result.current.isHydrated).toBe(true);
  });

  it("hands over an editor from the offline cache, without waiting for a socket", async () => {
    cacheDocument("doc-doc-1", "written on a previous visit");
    const { result } = render();

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    // The provider is built but has not synced; the cache alone is enough.
    await waitFor(() => expect(result.current.editor).not.toBeNull());
  });

  /**
   * Opening a cached document must not wait on the network deciding what it
   * is. When the browser still believes it is online but nothing answers, the
   * token mint hangs: no provider is ever built and the connection sits in
   * `connecting`. The editor used to require one of those to resolve, so a
   * document already on the device sat behind a blank page until the mint
   * finally failed — and then opened already marked offline.
   */
  it("opens a cached document immediately, while the connection is still being attempted", async () => {
    cacheDocument("doc-doc-1", "written on a previous visit");
    // A token that never arrives, so no provider is ever constructed.
    mint.run = () => new Promise(() => {});

    const { result } = render();

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.editor).not.toBeNull();
    // Still trying — not connected, and not yet given up. That is what the
    // toolbar shows while the document is already readable.
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it("settles from connecting to offline without taking the document away", async () => {
    cacheDocument("doc-doc-1", "written on a previous visit");
    mint.run = () => new Promise(() => {});

    const { result } = render();
    await waitFor(() => expect(result.current.editor).not.toBeNull());
    expect(result.current.isConnecting).toBe(true);

    window.dispatchEvent(new Event("offline"));

    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current.isConnecting).toBe(false);
    // The verdict changes the indicator, never the content.
    expect(result.current.editor).not.toBeNull();
  });

  /**
   * The regression this whole change exists for. `isOffline` used to be enough
   * to unblock the editor, so a document this device had never opened — or one
   * the collaboration server was merely slow to answer for — was handed over
   * blank and writable, and the first keystroke started a rival root.
   */
  it("refuses to open an editor on a document it has never been told the contents of", async () => {
    const { result } = render();

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    // The room never answers and the connection gives up.
    window.dispatchEvent(new Event("offline"));

    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current.isHydrated).toBe(false);
    expect(result.current.editor).toBeNull();
  });

  describe("the shared empty root", () => {
    it("is written once the document is known to be empty", async () => {
      const { result } = render();
      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));

      expect(result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
      FakeProvider.instances[0].sync();

      await waitFor(() =>
        expect(result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(1),
      );
    });

    it("is not written into a document whose contents are unknown", async () => {
      const { result } = render();
      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      window.dispatchEvent(new Event("offline"));
      await waitFor(() => expect(result.current.isOffline).toBe(true));

      // Seeding here would be inventing a root beside whatever the real
      // document already has.
      expect(result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
    });

    it("leaves a cached document's own root alone", async () => {
      cacheDocument("doc-doc-1", "already has a root");
      const { result } = render();

      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      const fragment = result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT);
      expect(fragment.length).toBe(1);
      expect(fragment.toJSON()).toContain("already has a root");
    });

    /**
     * A task whose description is still being seeded from a GitHub issue is
     * about to receive a root of its own, authored server-side. Bootstrapping
     * one here would produce exactly the two-root document the seed prevents
     * everywhere else.
     */
    it("waits for a pending GitHub description seed rather than racing it", async () => {
      const { result } = render({
        resourceType: "task",
        documentId: "task-1",
        seed: {
          expected: true,
          snapshotId: null,
          edited: false,
          statusLoading: false,
          seedStatus: "pending",
        },
      });

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      FakeProvider.instances[0].sync();
      await waitFor(() => expect(result.current.isHydrated).toBe(true));

      expect(result.current.descriptionReady).toBe(false);
      expect(result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
      expect(result.current.editor).toBeNull();
    });

    it("bootstraps a task once the seed resolves to nothing", async () => {
      const { result } = render({
        resourceType: "task",
        documentId: "task-2",
        seed: {
          expected: true,
          snapshotId: null,
          edited: false,
          statusLoading: false,
          seedStatus: "skipped",
        },
      });

      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      FakeProvider.instances[0].sync();

      await waitFor(() =>
        expect(result.current.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(1),
      );
      expect(result.current.editor).not.toBeNull();
    });
  });
});
