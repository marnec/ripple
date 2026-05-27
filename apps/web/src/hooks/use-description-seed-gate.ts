import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { useConvex } from "convex/react";
import { extractTextFromXml } from "@ripple/shared/blockRef";
import { api } from "@convex/_generated/api";
import { SEED_ORIGIN } from "../lib/yjs-origins";

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
   * "skipped" / "failed" resolves the gate deterministically. `undefined` only
   * for legacy links predating the field (a real in-flight seed is born
   * "pending" atomically with the link, so it's never seen as `undefined`) —
   * treated as "nothing in flight", so the gate opens without waiting.
   */
  seedStatus?: "pending" | "seeded" | "skipped" | "failed";
}

export interface DescriptionSeedGate {
  /**
   * False only while the editor is intentionally held back waiting for a GitHub
   * description seed. `true` for all other cases (no seed expected/in flight,
   * cache present, or snapshot loaded). Drives the blocking-spinner state.
   */
  descriptionReady: boolean;
  /**
   * True while specifically held back for a seed (not generic provider
   * loading). Drives the "seeding from GitHub" disclaimer; false once the seed
   * reaches a terminal status.
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

  // The task-detail sheet stays mounted across task switches and close/reopen —
  // only `documentId` changes (see Tasks.tsx / KanbanBoard.tsx, and the matching
  // yDoc-recreation note in use-yjs-provider). So `snapshotApplied` would
  // otherwise leak from the previously opened task: a stale `true` makes a
  // freshly opened, still-seeding task look ready, so the editor opens empty
  // with no spinner and the seeded description only pops in later. Reset on
  // resource change using React's "adjust state while rendering" idiom (as
  // useTaskDetail does for the title), so the very first render of the new task
  // already sees cleared state. `hydratedKeyRef` doesn't need resetting — its
  // key includes documentId.
  const [seededForDocId, setSeededForDocId] = useState(documentId);
  if (seededForDocId !== documentId) {
    setSeededForDocId(documentId);
    if (snapshotApplied) setSnapshotApplied(false);
  }

  // Whether a seed is genuinely in flight. The server writes "pending" atomically
  // with the link row (createTaskFromEvent), drives it to a terminal status on
  // every exit (seeded/skipped/failed — see seedDescriptionAction), and never
  // demotes "seeded". So `seedStatus` is the single source of truth for the gate;
  // no timeout backstop is needed. `undefined` means a legacy link predating the
  // field — never an in-flight seed — so it counts as "nothing coming".
  const seedTerminalNotSeeded = seedStatus === "skipped" || seedStatus === "failed";
  const seedInFlight = seedStatus === "pending";
  // NOT dropped when PartyKit is offline: the seed is fetched from Convex storage
  // (see the hydration effect above), reachable even when PartyKit isn't — so a
  // seed can still land, and bypassing the wait would flash an empty editor and
  // then pop the seed in. We keep blocking + showing the "seeding…" notice until
  // the status goes terminal.
  const blockingForSeed =
    expected && !edited && !snapshotApplied && !hasCachedText && seedInFlight;

  // Ready as soon as we're sure no seed will fill the editor. Positive "we have
  // content / no wait" signals short-circuit immediately (cached or edited tasks
  // open instantly): real text cached locally (a blank paragraph does NOT
  // count), a prior user edit, the seed's content applied, or the server reported
  // a terminal non-seeded outcome (skipped/failed → nothing is coming). Otherwise
  // we may only declare ready once the GitHub-link query has resolved AND there's
  // no in-flight seed — while it's still loading we hold back rather than flash an
  // empty editor (which would also plant the blank paragraph that defeats the
  // cache check). A resolved-but-`undefined` status is a legacy link with nothing
  // in flight, so it opens too.
  const seedStatusResolved = !(resourceType === "task" && statusLoading);
  const descriptionReady =
    hasCachedText ||
    edited ||
    snapshotApplied ||
    seedTerminalNotSeeded ||
    // Offline only short-circuits when NO seed is expected — otherwise we wait
    // for the Convex-delivered seed (above). Fully-offline non-seed tasks (where
    // the link query can't even resolve) still open immediately here.
    (isOffline && !expected) ||
    // Link query resolved with nothing in flight: open unless we're still
    // waiting on a "seeded" snapshot's content to hydrate (that path waits for
    // `snapshotApplied`). Covers non-seed tasks (!expected) and legacy links
    // (no status field) alike.
    (seedStatusResolved && !seedInFlight && (!expected || seedStatus === undefined));

  return {
    descriptionReady,
    // Show the "seeding…" notice only while the seed is genuinely in flight and
    // we're still blocking. Terminal statuses drop it.
    awaitingSeed: blockingForSeed,
  };
}
