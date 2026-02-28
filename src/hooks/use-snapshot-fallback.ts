import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

/**
 * Cold-start snapshot fallback: when the user is offline and no editor/IndexedDB
 * data is available, fetches a V2-encoded Yjs snapshot from storage.
 *
 * Returns `isColdStart` (whether we're in cold-start mode) and `snapshotDoc`
 * (the loaded Y.Doc, or null while loading). Callers can extract whatever they
 * need from the Y.Doc (e.g. XmlFragment for documents, Array for diagrams).
 *
 * IMPORTANT: Uses Y.applyUpdateV2 — never use y-partykit's load callback.
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
  resourceType: "doc" | "diagram";
  resourceId: Id<"documents"> | Id<"diagrams">;
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
        Y.applyUpdateV2(tempDoc, new Uint8Array(arrayBuffer));
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
