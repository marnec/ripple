import type * as Y from "yjs";
import type { CollaborativeDoc } from "./use-collaborative-doc";
import { useCursorIdentity } from "./use-cursor-identity";

export interface UseDiagramCollaborationOptions {
  /** The hydrated replica, from the surface that owns it. */
  doc: CollaborativeDoc;
  userName: string;
  userId: string;
}

export interface UseDiagramCollaborationResult {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
}

/**
 * A diagram's collaborative document in the shape y-excalidraw expects, with
 * this user's cursor identity published on its awareness.
 *
 * It no longer opens a room. `CollaborativeSurface` does that and hands the
 * hydrated replica down, which is what stops this hook from being a pass-through
 * that re-declared eleven fields to forward eight of them.
 */
export function useDiagramCollaboration({
  doc,
  userName,
  userId,
}: UseDiagramCollaborationOptions): UseDiagramCollaborationResult {
  const { yDoc, awareness } = doc;

  const yElements = yDoc.getArray<Y.Map<any>>("elements");
  const yAssets = yDoc.getMap("assets");

  useCursorIdentity(awareness, userName, userId);

  return { yElements, yAssets };
}
