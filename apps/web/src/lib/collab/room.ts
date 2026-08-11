import { buildRoomId, type ResourceType } from "@ripple/shared/protocol";

/**
 * A collaborative room, addressed once.
 *
 * The `{resourceType}-{resourceId}` convention used to be re-typed as a
 * template literal at every site that needed it — the PartyKit room, the
 * IndexedDB database name, the token cache key — which is how
 * `diagram-${id}` ended up hand-written in three separate hooks. Build a
 * descriptor instead and the string exists in exactly one place.
 */

/** Resource kinds that carry a Yjs document. `presence` is a room, not a doc. */
export type CollabResourceType = Exclude<ResourceType, "presence">;

/**
 * Re-exported so a collaboration surface reaches for the room descriptor and
 * the fragment name from one place. The value itself is owned by
 * `@ripple/shared`, because Convex and PartyKit bind to the same fragment.
 */
export { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";

export interface CollabRoom {
  resourceType: CollabResourceType;
  resourceId: string;
  /** PartyKit room name, and the collaboration-token cache key. */
  roomId: string;
  /** IndexedDB database name holding this room's offline cache. */
  persistenceKey: string;
}

export function collabRoom(
  resourceType: CollabResourceType,
  resourceId: string,
): CollabRoom {
  const roomId = buildRoomId(resourceType, resourceId);
  return {
    resourceType,
    resourceId,
    roomId,
    // Deliberately the same string. Changing it would orphan every user's
    // existing offline cache, so it is one value with two names, not two.
    persistenceKey: roomId,
  };
}
