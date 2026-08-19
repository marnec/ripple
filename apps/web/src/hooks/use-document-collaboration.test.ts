import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { cacheDocument, FakeProvider, mint, resetCollabFakes } from "@/test/collab-fakes";
import { useResourceDoc } from "./use-collab-session";
import { useDocumentCollaboration, type DescriptionSeed } from "./use-document-collaboration";

/**
 * Whether a collaborative editor is handed to the caller at all.
 *
 * The rule under test is one line — no editor until the replica is hydrated —
 * but it is the line that decides whether a user can type into a document
 * whose contents nobody has told this device. `empty-document.test.ts` covers
 * what that typing would cost.
 */

vi.mock("y-partyserver/provider", async () => ({
  default: (await import("@/test/collab-fakes")).FakeProvider,
}));
vi.mock("y-indexeddb", async () => ({
  IndexeddbPersistence: (await import("@/test/collab-fakes")).FakeIndexeddbPersistence,
}));
vi.mock("convex/react", async () => {
  const { convexQuery: query, mint: token } = await import("@/test/collab-fakes");
  return {
    useConvex: () => ({ query }),
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
    useAction: () => () => token.run(),
  };
});

const schema = BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs });

function render(options: {
  documentId?: string;
  resourceType?: "doc" | "task";
  seed?: DescriptionSeed;
} = {}) {
  // The room is opened by the caller now — `CollaborativeSurface` in the app,
  // this helper in the tests — and handed in.
  return renderHook(() => {
    const doc = useResourceDoc({
      resourceType: options.resourceType ?? "doc",
      resourceId: options.documentId ?? "doc-1",
    });
    return {
      ...useDocumentCollaboration({
        doc,
        documentId: options.documentId ?? "doc-1",
        userName: "Ada",
        userId: "user-1",
        schema,
        resourceType: options.resourceType ?? "doc",
        seed: options.seed,
      }),
      doc,
    };
  });
}

beforeEach(() => {
  resetCollabFakes();
  clearCollaborationTokenCache();
});

describe("useDocumentCollaboration", () => {
  it("hands over an editor once the room has answered", async () => {
    const { result } = render();

    await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
    expect(result.current.editor).toBeNull();

    FakeProvider.instances[0].sync();

    await waitFor(() => expect(result.current.editor).not.toBeNull());
    expect(result.current.doc.isHydrated).toBe(true);
  });

  it("hands over an editor from the offline cache, without waiting for a socket", async () => {
    cacheDocument("doc-doc-1", "written on a previous visit");
    const { result } = render();

    await waitFor(() => expect(result.current.doc.isHydrated).toBe(true));
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

    await waitFor(() => expect(result.current.doc.isHydrated).toBe(true));
    expect(result.current.editor).not.toBeNull();
    // Still trying — not connected, and not yet given up. That is what the
    // toolbar shows while the document is already readable.
    expect(result.current.doc.isConnected).toBe(false);
    expect(result.current.doc.isConnecting).toBe(true);
    expect(result.current.doc.isOffline).toBe(false);
  });

  it("settles from connecting to offline without taking the document away", async () => {
    cacheDocument("doc-doc-1", "written on a previous visit");
    mint.run = () => new Promise(() => {});

    const { result } = render();
    await waitFor(() => expect(result.current.editor).not.toBeNull());
    expect(result.current.doc.isConnecting).toBe(true);

    window.dispatchEvent(new Event("offline"));

    await waitFor(() => expect(result.current.doc.isOffline).toBe(true));
    expect(result.current.doc.isConnecting).toBe(false);
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

    await waitFor(() => expect(result.current.doc.isOffline).toBe(true));
    expect(result.current.doc.isHydrated).toBe(false);
    expect(result.current.editor).toBeNull();
  });

  describe("the shared empty root", () => {
    it("is written once the document is known to be empty", async () => {
      const { result } = render();
      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));

      expect(result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
      FakeProvider.instances[0].sync();

      await waitFor(() =>
        expect(result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(1),
      );
    });

    it("is not written into a document whose contents are unknown", async () => {
      const { result } = render();
      await waitFor(() => expect(FakeProvider.instances).toHaveLength(1));
      window.dispatchEvent(new Event("offline"));
      await waitFor(() => expect(result.current.doc.isOffline).toBe(true));

      // Seeding here would be inventing a root beside whatever the real
      // document already has.
      expect(result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
    });

    it("leaves a cached document's own root alone", async () => {
      cacheDocument("doc-doc-1", "already has a root");
      const { result } = render();

      await waitFor(() => expect(result.current.doc.isHydrated).toBe(true));
      const fragment = result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT);
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
      await waitFor(() => expect(result.current.doc.isHydrated).toBe(true));

      expect(result.current.descriptionReady).toBe(false);
      expect(result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(0);
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
        expect(result.current.doc.yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(1),
      );
      expect(result.current.editor).not.toBeNull();
    });
  });
});
