import type { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { frameViewElements } from "@/pages/App/Diagram/frames";

/** Thrown when a diagram (or the chosen frame) has no drawable content. */
export class EmptyDiagramSnapshotError extends Error {
  constructor() {
    super("Diagram has no content to snapshot");
    this.name = "EmptyDiagramSnapshotError";
  }
}

/** Thrown when the diagram has never been persisted, so there is nothing to rasterise. */
export class MissingDiagramSnapshotError extends Error {
  constructor() {
    super("Diagram has no saved snapshot");
    this.name = "MissingDiagramSnapshotError";
  }
}

/**
 * Fetch a diagram's persisted Yjs state and rasterise it to a PNG blob.
 *
 * The single entry point for "freeze this diagram as an image": chat's
 * `#`-reference snapshot and the document diagram block's snapshot action both
 * go through here, so they capture the same bytes the same way.
 */
export async function fetchDiagramSnapshotBlob(
  convex: ConvexReactClient,
  diagramId: Id<"diagrams">,
  frameId: string | null,
): Promise<Blob> {
  const snapshotUrl = await convex.query(api.snapshots.getSnapshotUrl, {
    resourceType: "diagram",
    resourceId: diagramId,
  });
  if (!snapshotUrl) throw new MissingDiagramSnapshotError();
  const res = await fetch(snapshotUrl);
  if (!res.ok) throw new Error(`Diagram snapshot fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return snapshotDiagramToBlob(bytes, frameId);
}

/**
 * Rasterise a static PNG snapshot of a diagram from a persisted Yjs update.
 *
 * Builds a throwaway Y.Doc from the snapshot bytes (the same V1 update the
 * collaboration server stores), converts its `elements`/`assets` to an
 * Excalidraw scene, and exports to a PNG blob. When `frameId` is given, only
 * that frame's content is exported — matching the document embed's
 * `frameViewElements` selection (natural bounds, no clip).
 *
 * Excalidraw + y-excalidraw are heavy and chat-only-incidentally, so they're
 * dynamically imported here to stay out of the chat bundle's entry chunk.
 */
export async function snapshotDiagramToBlob(
  update: Uint8Array,
  frameId: string | null,
): Promise<Blob> {
  const [{ exportToBlob }, { yjsToExcalidraw }, Y] = await Promise.all([
    import("@excalidraw/excalidraw"),
    import("y-excalidraw"),
    import("yjs"),
  ]);

  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    const all = yjsToExcalidraw(doc.getArray("elements")) as Array<
      Parameters<typeof frameViewElements>[0][number]
    >;
    const files = doc.getMap("assets").toJSON();

    const selected = frameId ? frameViewElements(all, frameId) : all;
    // Fall back to the whole scene if the frame selection came back empty
    // (e.g. a frame whose members were deleted) so we never export a blank PNG.
    const elements = selected.length > 0 ? selected : all;
    if (elements.length === 0) throw new EmptyDiagramSnapshotError();

    return await exportToBlob({
      elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
      files: files as Parameters<typeof exportToBlob>[0]["files"],
      appState: {
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
        frameRendering: { enabled: true, name: false, outline: false, clip: false },
      },
      mimeType: "image/png",
      quality: 1,
    });
  } finally {
    doc.destroy();
  }
}
