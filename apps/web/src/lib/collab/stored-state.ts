import type { CollabResourceType } from "./room";

/**
 * The last source of state a replica has: the snapshot the collaboration
 * server persists to Convex storage, reached only once the room is unreachable
 * and this device has no cache.
 *
 * The interesting part is not the fetch — it is that "we got nothing" has
 * three different meanings, and only one of them is knowledge. This module
 * exists to name them, so a caller branches on a value instead of on the shape
 * of a try/catch.
 */
export type StoredState =
  /** The room has content, and this is it. */
  | { status: "content"; update: Uint8Array }
  /**
   * Nothing has ever been stored for this resource. That IS knowledge about
   * its contents — it has none — which is why this is asked as
   * `getStoredState` and not `getSnapshotUrl`: a brand-new document must read
   * as empty rather than as unavailable while the room is slow to answer.
   */
  | { status: "empty" }
  /**
   * No access, no such resource, a snapshot pointing at a blob that is gone.
   * Not knowledge, and not worth asking again — nothing about this answer is
   * expected to change on a retry.
   */
  | { status: "unavailable" }
  /**
   * The read itself failed — the network, the storage host, a corrupt body.
   * Also not knowledge, but unlike `unavailable` a later attempt may succeed,
   * so the caller should leave the door open rather than record an answer.
   */
  | { status: "failed"; error: unknown };

/** What `snapshots.getStoredState` answers. Kept structural, not imported from
 * the generated API, so this module can be tested without Convex. */
export type StoredStateQuery = (args: {
  resourceType: CollabResourceType;
  resourceId: string;
}) => Promise<
  { status: "stored"; url: string } | { status: "empty" } | { status: "unavailable" }
>;

export async function readStoredState(
  query: StoredStateQuery,
  resource: { resourceType: CollabResourceType; resourceId: string },
): Promise<StoredState> {
  try {
    const stored = await query(resource);
    if (stored.status !== "stored") return stored;

    const response = await fetch(stored.url);
    // Without this an error page is read as a snapshot: `arrayBuffer()` on a
    // 404 hands back the error body, and those bytes reach `Y.applyUpdate`.
    if (!response.ok) {
      return {
        status: "failed",
        error: new Error(`Snapshot blob responded ${response.status}`),
      };
    }
    return { status: "content", update: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { status: "failed", error };
  }
}

/**
 * Whether an answer settles what this room holds. `empty` counts — that is the
 * whole point of asking.
 */
export function isKnowledge(state: StoredState): boolean {
  return state.status === "content" || state.status === "empty";
}
