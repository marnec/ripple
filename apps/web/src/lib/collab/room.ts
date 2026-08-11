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
 * The Y.Doc fragment BlockNote binds to. Shared with the Convex seeding action
 * and the partyserver snapshot reader — all three must agree or a seeded
 * document reads back empty.
 */
export const DOCUMENT_FRAGMENT = "document-store";

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
