import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { useConvex } from "convex/react";
import { extractTextFromXml } from "@ripple/shared/blockRef";
import { api } from "@convex/_generated/api";
import { SEED_ORIGIN } from "../lib/yjs-origins";

// Backstop only. Readiness is now driven by the reactive `seedStatus` from the
// server (see useDescriptionSeedGate), so this timer is a last-resort safety net
// for legacy links lacking that field. Generously long: it should almost never
// be the thing that unblocks the editor. A late seed still merges afterwards
// (the doc stays empty → hydration applies).
export const SEED_WAIT_TIMEOUT_MS = 20000;

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
  /**
   * Reactive seed lifecycle from the server (`taskIntegrationLinks.seedStatus`).
   * "pending" while the seed action is in flight; a terminal "seeded" /
   * "skipped" / "failed" resolves the gate deterministically. `undefined` for
   * legacy links or tasks that never scheduled a seed — the backstop timer
   * covers those.
   */
  seedStatus?: "pending" | "seeded" | "skipped" | "failed";
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
  isOffline,
  hasCachedText,
  seed,
}: {
  resourceType: "doc" | "diagram" | "task";
  documentId: string;
  yDoc: Y.Doc;
  /**
   * Provider gave up reaching PartyKit (timeout / browser offline). The seed
   * blob lives in Convex storage, so hydration no longer needs the PartyKit
   * connection — a seed can still land while PartyKit is offline. So this only
   * opens the editor immediately when NO seed is expected (so an offline,
   * non-seeded task behaves like a document); a pending seed still blocks and
   * shows the notice until it arrives (or the backstop fires).
   */
  isOffline: boolean;
  /** IndexedDB had real (non-blank) text cached — short-circuits the wait. */
  hasCachedText: boolean;
  seed: DescriptionSeed | undefined;
}): DescriptionSeedGate {
  const convex = useConvex();
  const expected = seed?.expected ?? false;
  const edited = seed?.edited ?? false;
  const statusLoading = seed?.statusLoading ?? false;
  const snapshotId = seed?.snapshotId ?? null;
  const seedStatus = seed?.seedStatus;

  // Recovery for a server snapshot that lands AFTER the room cold-loaded empty —
  // notably the GitHub description seed, whose Node-action conversion can finish
  // after the user has already opened the (then-empty) task. PartyKit's onLoad
  // reads the snapshot only once, so without this the seeded description never
  // appears in that session. Reactivity comes from `snapshotId` (the already-open
  // taskLinks.getByTask subscription), so the URL is fetched as a ONE-SHOT — no
  // standing subscription on the signed storage URL.
  //
  // Deliberately NOT gated on PartyKit `isConnected`: the seed blob lives in
  // Convex storage (getSnapshotUrl), reachable whenever Convex is — so the seed
  // hydrates even when PartyKit is down. Applying this same canonical update on
  // the client and (later) via PartyKit's onLoad is an idempotent Yjs merge, so
  // the double-apply is a no-op, not duplication. We merge only while the live
  // doc is still empty, so we never clobber real content. Tagged SEED_ORIGIN so
  // edit-detection ignores it.
  const [snapshotApplied, setSnapshotApplied] = useState(false);
  // The (documentId, snapshotId) we last hydrated from, so a *changed* id (seed
  // replacing an empty auto-save) re-triggers, but the same id never re-fetches.
  // Keying on documentId too means a task switch never reuses the prior task's
  // hydration mark — no render-time reset needed (the sheet stays mounted).
  const hydratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (resourceType !== "task" || !snapshotId) return;
    const hydrationKey = `${documentId}:${snapshotId}`;
    if (hydratedKeyRef.current === hydrationKey) return;
    hydratedKeyRef.current = hydrationKey;

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
        // unblock; we wait for the seed's id to arrive (or the backstop).
        if (!cancelled && hasContent()) setSnapshotApplied(true);
      } catch (error) {
        console.error("Failed to hydrate task description from snapshot:", error);
        // Allow a later render (e.g. Convex reconnects) to retry this same id.
        if (!cancelled) hydratedKeyRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, yDoc, resourceType, documentId, convex]);

  // Backstop only: with the reactive `seedStatus` driving readiness below, this
  // timer matters solely for legacy links whose status is `undefined` (and a
  // seed is somehow still expected without ever resolving). It is no longer the
  // primary mechanism, so it's generously long. A late seed still merges via the
  // hydration effect above (the doc stays empty until it arrives).
  const [seedTimedOut, setSeedTimedOut] = useState(false);

  // The task-detail sheet stays mounted across task switches — only
  // `documentId` changes (see Tasks.tsx / KanbanBoard.tsx, and the matching
  // yDoc-recreation note in use-yjs-provider). So this transient per-resource
  // state would otherwise leak from the previously opened task. A stale
  // `snapshotApplied` is the dangerous one: it makes a freshly opened task that
  // is still seeding look ready, so the editor opens empty with no spinner and
  // the seeded description only pops in later. Reset on resource change using
  // React's "adjust state while rendering" idiom (as useTaskDetail does for the
  // title), so the very first render of the new task already sees cleared state.
  // `hydratedIdRef` doesn't need resetting here — its key includes documentId.
  const [seededForDocId, setSeededForDocId] = useState(documentId);
  if (seededForDocId !== documentId) {
    setSeededForDocId(documentId);
    if (snapshotApplied) setSnapshotApplied(false);
    if (seedTimedOut) setSeedTimedOut(false);
  }

  // NOT dropped when PartyKit is offline: the seed is fetched from Convex
  // storage (see the hydration effect above), which is reachable even when
  // PartyKit isn't — so a seed can still land, and bypassing the wait would
  // flash an empty editor and then pop the seed in (no spinner shown). We keep
  // blocking + showing the "seeding…" notice; the backstop is the escape if the
  // seed truly never arrives (e.g. Convex is also unreachable).
  const seedTerminalNotSeeded = seedStatus === "skipped" || seedStatus === "failed";
  const blockingForSeed =
    expected && !edited && !snapshotApplied && !hasCachedText && !seedTerminalNotSeeded;
  useEffect(() => {
    if (!blockingForSeed) return;
    const timer = setTimeout(() => setSeedTimedOut(true), SEED_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [blockingForSeed]);

  // Ready as soon as we're sure no seed will fill the editor. Positive "we have
  // content / no wait" signals short-circuit immediately (cached or edited tasks
  // open instantly): real text cached locally (a blank paragraph does NOT
  // count), a prior user edit, the seed's content applied, the server reported a
  // terminal non-seeded outcome (skipped/failed → nothing is coming), offline,
  // or the backstop fired. Otherwise we may only declare ready once the
  // GitHub-link query has resolved AND reports no seed — while it's still loading
  // we hold back rather than flash an empty editor (which would also plant the
  // blank paragraph that defeats the cache check).
  const seedStatusResolved = !(resourceType === "task" && statusLoading);
  const descriptionReady =
    hasCachedText ||
    edited ||
    snapshotApplied ||
    seedTerminalNotSeeded ||
    seedTimedOut ||
    // Offline only short-circuits when NO seed is expected — otherwise we wait
    // for the Convex-delivered seed (above). Fully-offline non-seed tasks (where
    // the link query can't even resolve) still open immediately here.
    (isOffline && !expected) ||
    (seedStatusResolved && !expected);

  return {
    descriptionReady,
    // Show the "seeding…" notice only while the seed is genuinely in flight:
    // server says pending (or hasn't reported yet on a legacy link) and we're
    // still blocking. Terminal statuses and the backstop drop it.
    awaitingSeed:
      blockingForSeed &&
      (seedStatus === "pending" || seedStatus === undefined) &&
      !seedTimedOut,
  };
}
