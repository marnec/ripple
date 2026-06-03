import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { IndexeddbPersistence } from "y-indexeddb";
import { yjsToExcalidraw } from "y-excalidraw";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Reactively loads a diagram's Excalidraw elements from the best available
 * source — IndexedDB cache (instant, includes the latest local edits) plus the
 * Convex snapshot (cross-device) — without opening a collaboration socket.
 *
 * Mirrors {@link useDiagramPreview}'s loading strategy but exposes the raw
 * element list, used by the frame picker to enumerate frames. Pass
 * `enabled: false` to skip all work (e.g. while a dialog is closed).
 */
export function useDiagramScene(
  diagramId: Id<"diagrams"> | null,
  enabled: boolean,
): { elements: readonly ExcalidrawElement[]; isLoading: boolean } {
  const snapshotUrl = useQuery(
    api.snapshots.getSnapshotUrl,
    enabled && diagramId
      ? { resourceType: "diagram", resourceId: diagramId }
      : "skip",
  );

  const [elements, setElements] = useState<readonly ExcalidrawElement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // One Y.Doc per diagramId; recreated when the target diagram changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yDoc = useMemo(() => new Y.Doc(), [diagramId]);
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  useEffect(() => {
    if (!enabled || !diagramId) return;
    let cancelled = false;

    const read = () => {
      if (cancelled) return;
      const yElements = yDoc.getArray<Y.Map<any>>("elements");
      setElements(yjsToExcalidraw(yElements) as readonly ExcalidrawElement[]);
      setIsLoading(false);
    };

    const persistence = new IndexeddbPersistence(`diagram-${diagramId}`, yDoc);
    persistence.on("synced", read);

    const yElements = yDoc.getArray<Y.Map<any>>("elements");
    const observe = () => read();
    yElements.observeDeep(observe);

    // Stop showing the spinner even if no source produced data.
    const fallback = setTimeout(() => {
      if (!cancelled) setIsLoading(false);
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
      yElements.unobserveDeep(observe);
      void persistence.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, enabled]);

  // Apply the Convex snapshot when its URL resolves/changes.
  useEffect(() => {
    if (!snapshotUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(snapshotUrl);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (!cancelled) Y.applyUpdate(yDoc, new Uint8Array(buf));
      } catch {
        // Best-effort; IndexedDB may already have provided data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotUrl, yDoc]);

  return { elements, isLoading };
}
