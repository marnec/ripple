import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { useDescriptionSeedGate, type DescriptionSeed } from "./use-description-seed-gate";

// The gate only touches Convex inside the snapshot-hydration effect, and only
// when `snapshotId` is set. The readiness cases below pass no snapshotId, so
// `convex.query` is never reached — a no-op stub suffices.
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn() }),
}));

function gate(overrides: {
  isOffline?: boolean;
  hasCachedText?: boolean;
  seed?: Partial<DescriptionSeed>;
}) {
  const seed: DescriptionSeed = {
    expected: false,
    snapshotId: null,
    edited: false,
    statusLoading: false,
    ...overrides.seed,
  };
  return renderHook(() =>
    useDescriptionSeedGate({
      resourceType: "task",
      documentId: "task-1",
      yDoc: new Y.Doc(),
      isOffline: overrides.isOffline ?? false,
      hasCachedText: overrides.hasCachedText ?? false,
      seed,
    }),
  );
}

describe("useDescriptionSeedGate", () => {
  it("keeps waiting (and shows the notice) for a pending seed even when PartyKit is offline", () => {
    // The seed is fetched from Convex storage, reachable even when PartyKit is
    // offline — so we must NOT bypass the wait and flash an empty editor. We
    // keep blocking and show the "seeding…" notice until the seed lands.
    const { result } = gate({
      isOffline: true,
      seed: { expected: true, snapshotId: null, statusLoading: false, seedStatus: "pending" },
    });
    expect(result.current.descriptionReady).toBe(false);
    expect(result.current.awaitingSeed).toBe(true);
  });

  it("opens a non-seeded task immediately when offline (regression)", () => {
    // The original "editor disappears offline" bug: a task with no seed expected
    // must open right away offline, like a document — even if the link query
    // never resolves (fully offline → statusLoading true, expected false).
    const { result } = gate({
      isOffline: true,
      seed: { expected: false, snapshotId: null, statusLoading: true },
    });
    expect(result.current.descriptionReady).toBe(true);
    expect(result.current.awaitingSeed).toBe(false);
  });

  it("blocks while the server reports the seed pending", () => {
    // Seed in flight (status pending): hold the editor so the user can't type
    // into a doc about to be filled. The notice is shown.
    const { result } = gate({
      seed: { expected: true, snapshotId: null, seedStatus: "pending" },
    });
    expect(result.current.descriptionReady).toBe(false);
    expect(result.current.awaitingSeed).toBe(true);
  });

  it("opens immediately when the server reports a terminal non-seeded status", () => {
    // "skipped"/"failed" mean nothing is coming — unblock immediately.
    for (const seedStatus of ["skipped", "failed"] as const) {
      const { result } = gate({
        seed: { expected: true, snapshotId: null, seedStatus },
      });
      expect(result.current.descriptionReady).toBe(true);
      expect(result.current.awaitingSeed).toBe(false);
    }
  });

  it("opens a non-seeded task once the link query resolves", () => {
    const { result } = gate({ seed: { expected: false, statusLoading: false } });
    expect(result.current.descriptionReady).toBe(true);
    expect(result.current.awaitingSeed).toBe(false);
  });

  it("opens immediately when real text is cached locally, even with a pending seed", () => {
    const { result } = gate({
      hasCachedText: true,
      seed: { expected: true, statusLoading: true, seedStatus: "pending" },
    });
    expect(result.current.descriptionReady).toBe(true);
  });

  it("opens immediately for a legacy link with no seedStatus (nothing in flight)", () => {
    // A real in-flight seed is born "pending" atomically with the link, so an
    // absent status can only be a legacy link predating the field — nothing is
    // coming, so don't wait (no timeout backstop).
    const { result } = gate({
      seed: { expected: true, snapshotId: null, statusLoading: false, seedStatus: undefined },
    });
    expect(result.current.descriptionReady).toBe(true);
    expect(result.current.awaitingSeed).toBe(false);
  });

  it("resets snapshotApplied when the open task changes (regression)", async () => {
    // The detail sheet stays mounted across task switches and close/reopen (only
    // documentId changes). Without a per-resource reset, `snapshotApplied` from
    // the previous task would make a freshly opened, still-seeding task look
    // ready → editor opens empty with no spinner. Task A hydrates its seeded
    // snapshot (ready); switching to task B (still pending, empty) must block.
    const docA = new Y.Doc();
    const xmlText = new Y.XmlText();
    xmlText.insert(0, "seeded body");
    docA.getXmlFragment("document-store").push([xmlText]);

    const seedA: DescriptionSeed = {
      expected: true,
      snapshotId: "snap-A",
      edited: false,
      statusLoading: false,
      seedStatus: "seeded",
    };
    const seedB: DescriptionSeed = {
      expected: true,
      snapshotId: null,
      edited: false,
      statusLoading: false,
      seedStatus: "pending",
    };

    const { result, rerender } = renderHook(
      (props: { documentId: string; yDoc: Y.Doc; seed: DescriptionSeed }) =>
        useDescriptionSeedGate({
          resourceType: "task",
          documentId: props.documentId,
          yDoc: props.yDoc,
          isOffline: false,
          hasCachedText: false,
          seed: props.seed,
        }),
      { initialProps: { documentId: "task-A", yDoc: docA, seed: seedA } },
    );

    // Task A: the seeded snapshot's content is already in the doc → the
    // hydration effect marks snapshotApplied → ready.
    await waitFor(() => expect(result.current.descriptionReady).toBe(true));

    // Switch to task B (still pending, empty doc): snapshotApplied must reset so
    // the gate blocks again and shows the notice.
    rerender({ documentId: "task-B", yDoc: new Y.Doc(), seed: seedB });
    expect(result.current.descriptionReady).toBe(false);
    expect(result.current.awaitingSeed).toBe(true);
  });
});
