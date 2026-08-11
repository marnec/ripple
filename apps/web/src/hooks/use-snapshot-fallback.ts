import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { CollabResourceType } from "@/lib/collab/room";
import { SNAPSHOT_ORIGIN } from "@/lib/yjs-origins";

/**
 * Cold-start snapshot fallback: when the user is offline and no editor/IndexedDB
 * data is available, fetches a Yjs snapshot from storage.
 *
 * Returns `isColdStart` (whether we're in cold-start mode) and `snapshotDoc`
 * (the loaded Y.Doc, or null while loading). Callers can extract whatever they
 * need from the Y.Doc (e.g. XmlFragment for documents, Array for diagrams).
 *
 * Accepts every collaborative resource kind, matching `getSnapshotUrl` on the
 * backend. It used to admit only `doc | diagram`, so a spreadsheet with a
 * perfectly good snapshot in storage showed an empty grid on a cold device.
 */
export function useSnapshotFallback({
  isOffline,
  hasContent,
  resourceType,
  resourceId,
}: {
  /** Whether the collaboration provider reports offline. */
  isOffline: boolean;
  /** Whether content is already available (editor loaded, IndexedDB hydrated, etc). */
  hasContent: boolean;
  resourceType: CollabResourceType;
  resourceId: string;
}) {
  const isColdStart = isOffline && !hasContent;

  const snapshotUrl = useQuery(
    api.snapshots.getSnapshotUrl,
    isColdStart ? { resourceType, resourceId } : "skip",
  );

  const [snapshotDoc, setSnapshotDoc] = useState<Y.Doc | null>(null);

  // Reset snapshot when cold-start conditions change (derive from props)
  if (snapshotDoc && (!isColdStart || !snapshotUrl)) {
    setSnapshotDoc(null);
  }

  useEffect(() => {
    if (!snapshotUrl || !isColdStart) return;

    let cancelled = false;

    const loadSnapshot = async () => {
      try {
        const response = await fetch(snapshotUrl);
        const arrayBuffer = await response.arrayBuffer();
        const tempDoc = new Y.Doc();
        Y.applyUpdate(tempDoc, new Uint8Array(arrayBuffer));
        if (!cancelled) setSnapshotDoc(tempDoc);
      } catch (error) {
        console.error("Failed to load snapshot:", error);
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [snapshotUrl, isColdStart]);

  return { isColdStart, snapshotDoc };
}

/**
 * Cold-start fallback for surfaces that have no separate read-only renderer —
 * the spreadsheet grid is bound to the live Y.Doc and nothing else.
 *
 * Rather than render the snapshot beside the document, merge it into the
 * document. Applying a server-authored update to a CRDT is idempotent, and the
 * bytes came from that same server, so a later sync has nothing to reconcile:
 * whatever the room already knows simply wins.
 */
export function useSnapshotHydration({
  isOffline,
  hasContent,
  resourceType,
  resourceId,
  yDoc,
}: {
  isOffline: boolean;
  hasContent: boolean;
  resourceType: CollabResourceType;
  resourceId: string;
  yDoc: Y.Doc;
}): { isColdStart: boolean } {
  const { isColdStart, snapshotDoc } = useSnapshotFallback({
    isOffline,
    hasContent,
    resourceType,
    resourceId,
  });

  useEffect(() => {
    if (!snapshotDoc) return;
    Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(snapshotDoc), SNAPSHOT_ORIGIN);
  }, [snapshotDoc, yDoc]);

  return { isColdStart };
}
