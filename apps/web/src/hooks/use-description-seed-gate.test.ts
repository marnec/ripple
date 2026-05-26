import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
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
    // "skipped"/"failed" mean nothing is coming — unblock without waiting out
    // the backstop timer.
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

  it("falls back to the backstop timer for a legacy link with no seedStatus", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = gate({
        // Legacy: seed expected, link query resolved, but the status field is
        // absent and no snapshot ever arrives. Only the backstop unblocks.
        seed: { expected: true, snapshotId: null, statusLoading: false, seedStatus: undefined },
      });
      expect(result.current.descriptionReady).toBe(false);
      expect(result.current.awaitingSeed).toBe(true);

      vi.advanceTimersByTime(20_000);
      rerender();

      expect(result.current.descriptionReady).toBe(true);
      expect(result.current.awaitingSeed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets transient seed state when the open task changes (regression)", () => {
    // The detail sheet stays mounted across task switches (only documentId
    // changes). Without a per-resource reset, a `seedTimedOut`/`snapshotApplied`
    // left over from the previous task would make a freshly opened, still-seeding
    // task look ready → editor opens empty with no spinner. Here: task A times
    // out (ready), then switching to task B (still pending) must block again.
    vi.useFakeTimers();
    try {
      const seed: DescriptionSeed = {
        expected: true,
        snapshotId: null,
        edited: false,
        statusLoading: false,
        seedStatus: "pending",
      };
      const { result, rerender } = renderHook(
        ({ documentId }: { documentId: string }) =>
          useDescriptionSeedGate({
            resourceType: "task",
            documentId,
            yDoc: new Y.Doc(),
            isOffline: false,
            hasCachedText: false,
            seed,
          }),
        { initialProps: { documentId: "task-A" } },
      );

      // Task A: backstop fires → ready.
      vi.advanceTimersByTime(20_000);
      rerender({ documentId: "task-A" });
      expect(result.current.descriptionReady).toBe(true);

      // Switch to task B (still pending): the leaked seedTimedOut must be reset,
      // so the gate blocks again and shows the notice.
      rerender({ documentId: "task-B" });
      expect(result.current.descriptionReady).toBe(false);
      expect(result.current.awaitingSeed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
