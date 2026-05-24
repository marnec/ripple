import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { useConvex } from "convex/react";
import { extractTextFromXml } from "@ripple/shared/blockRef";
import { api } from "@convex/_generated/api";
import { SEED_ORIGIN } from "../lib/yjs-origins";

// How long to block an empty task editor waiting for a GitHub description seed
// before giving up and opening blank. Covers Node-action cold-start P99; a late
// seed still merges in afterwards (the doc is still empty → hydration applies).
export const SEED_WAIT_TIMEOUT_MS = 8000;

/**
 * Task-only signals describing whether a GitHub description seed is pending.
 * Sourced from `taskLinks.getByTask`; absent for non-task editors.
 */
export interface DescriptionSeed {
  /**
   * A GitHub body was captured at creation, so a server-side seed is/was
   * expected. While true and no content has loaded, the editor is held back so
   * the user can't type into a doc that's about to be filled by the seed.
   */
  expected: boolean;
  /**
   * The task's current description snapshot storage id (reactive), or null.
   * Used as the hydration trigger AND key: when it changes while the live doc
   * is empty, we one-shot-fetch and merge the seed. Watching the id (not a
   * boolean) is what catches the seed *replacing* an empty auto-saved snapshot.
   */
  snapshotId: string | null;
  /** Whether the user has already edited the description (no seed to wait for). */
  edited: boolean;
  /**
   * Whether the GitHub-link query (which yields the fields above) is still
   * loading. While true we don't yet know if a seed is coming, so the editor
   * stays gated rather than flashing empty.
   */
  statusLoading: boolean;
}

export interface DescriptionSeedGate {
  /**
   * False only while the editor is intentionally held back waiting for a GitHub
   * description seed. `true` for all other cases (no seed expected, cache
   * present, snapshot loaded, or timed out). Drives the blocking-spinner state.
   */
  descriptionReady: boolean;
  /**
   * True while specifically held back for a seed (not generic provider
   * loading). Drives the "seeding from GitHub" disclaimer; false once the seed
   * lands or the wait times out.
   */
  awaitingSeed: boolean;
}

/**
 * Encapsulates the GitHub description-seed gate for a task's collaborative
 * editor, keeping `useDocumentCollaboration` generic. Owns the one-shot
 * snapshot hydration (for a seed that lands after the room cold-loaded empty),
 * the bounded wait, and the readiness derivation.
 *
 * For non-task editors (no `seed`), it's inert: `descriptionReady` is always
 * true and `awaitingSeed` always false.
 */
export function useDescriptionSeedGate({
  resourceType,
  documentId,
  yDoc,
  isConnected,
  hasCachedText,
  seed,
}: {
  resourceType: "doc" | "diagram" | "task";
  documentId: string;
  yDoc: Y.Doc;
  isConnected: boolean;
  /** IndexedDB had real (non-blank) text cached — short-circuits the wait. */
  hasCachedText: boolean;
  seed: DescriptionSeed | undefined;
}): DescriptionSeedGate {
  const convex = useConvex();
  const expected = seed?.expected ?? false;
  const edited = seed?.edited ?? false;
  const statusLoading = seed?.statusLoading ?? false;
  const snapshotId = seed?.snapshotId ?? null;

  // Recovery for a server snapshot that lands AFTER the room cold-loaded empty —
  // notably the GitHub description seed, whose Node-action conversion can finish
  // after the user has already opened the (then-empty) task. PartyKit's onLoad
  // reads the snapshot only once, so without this the seeded description never
  // appears in that session. Reactivity comes from `snapshotId` (the already-open
  // taskLinks.getByTask subscription), so the URL is fetched as a ONE-SHOT — no
  // standing subscription on the signed storage URL. We merge into the live doc
  // only once the provider synced AND the doc is still empty, so we never clobber
  // real content. Tagged SEED_ORIGIN so edit-detection ignores it.
  const [snapshotApplied, setSnapshotApplied] = useState(false);
  // The snapshot id we last hydrated from, so a *changed* id (seed replacing an
  // empty auto-save) re-triggers, but the same id never re-fetches.
  const hydratedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (resourceType !== "task" || !snapshotId || !isConnected) return;
    if (hydratedIdRef.current === snapshotId) return;
    hydratedIdRef.current = snapshotId;

    let cancelled = false;
    void (async () => {
      try {
        const hasContent = () =>
          extractTextFromXml(yDoc.getXmlFragment("document-store")).trim().length > 0;
        // onLoad may have already delivered content via the provider; only
        // fetch+apply when the live doc is still empty.
        if (!hasContent()) {
          const url = await convex.query(api.snapshots.getSnapshotUrl, {
            resourceType,
            resourceId: documentId,
          });
          if (cancelled || !url) return;
          const buffer = await (await fetch(url)).arrayBuffer();
          if (cancelled) return;
          // Re-check: the provider may have delivered content mid-fetch.
          if (!hasContent()) {
            Y.applyUpdate(yDoc, new Uint8Array(buffer), SEED_ORIGIN);
          }
        }
        // Only unblock once the doc actually has content — an empty snapshot
        // (e.g. a stale empty auto-save before the seed overwrites it) must NOT
        // unblock; we wait for the seed's id to arrive (or the timeout).
        if (!cancelled && hasContent()) setSnapshotApplied(true);
      } catch (error) {
        console.error("Failed to hydrate task description from snapshot:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, isConnected, yDoc, resourceType, documentId, convex]);

  // Bounded wait: if a seed is expected but never lands with content (e.g. the
  // seed action errored), unblock the editor empty after a timeout. A late seed
  // still merges via the hydration effect above (the doc stays empty).
  const [seedTimedOut, setSeedTimedOut] = useState(false);
  const blockingForSeed = expected && !edited && !snapshotApplied && !hasCachedText;
  useEffect(() => {
    if (!blockingForSeed) return;
    const timer = setTimeout(() => setSeedTimedOut(true), SEED_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [blockingForSeed]);

  // Ready as soon as we're sure no seed will fill the editor. Positive "we have
  // content / no wait" signals short-circuit immediately (cached or edited tasks
  // open instantly): real text cached locally (a blank paragraph does NOT
  // count), a prior user edit, the seed's content applied, or we gave up
  // waiting. Otherwise we may only declare ready once the GitHub-link query has
  // resolved AND reports no seed — while it's still loading we hold back rather
  // than flash an empty editor (which would also plant the blank paragraph that
  // defeats the cache check).
  const seedStatusResolved = !(resourceType === "task" && statusLoading);
  const descriptionReady =
    hasCachedText ||
    edited ||
    snapshotApplied ||
    seedTimedOut ||
    (seedStatusResolved && !expected);

  return {
    descriptionReady,
    awaitingSeed: blockingForSeed && !seedTimedOut,
  };
}
