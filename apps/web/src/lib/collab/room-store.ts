import type { IndexeddbPersistence } from "y-indexeddb";

/**
 * A small key/value store scoped to one collaborative room.
 *
 * It lives in the `custom` object store of the room's own IndexedDB database —
 * the one y-indexeddb opens for the Yjs cache and never writes to itself. That
 * is the point: whatever we keep about a room is evicted with the room's
 * content rather than beside it, so the two can never disagree about what this
 * device knows.
 */
export interface RoomStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * A store that outlives the persistence instance behind it.
 *
 * The instance is replaced whenever the room changes and dropped on teardown,
 * while callers keep one object they can depend on. It owns that binding
 * itself rather than reading a React ref, so nothing about it is touched
 * during render.
 */
export interface AttachableRoomStore extends RoomStore {
  /** Point the store at a persistence instance, or at nothing on teardown. */
  attach(persistence: IndexeddbPersistence | null): void;
}

export function createRoomStore(): AttachableRoomStore {
  let persistence: IndexeddbPersistence | null = null;
  return {
    attach(next) {
      persistence = next;
    },
    async get<T>(key: string): Promise<T | null> {
      if (!persistence) return null;
      const raw = await persistence.get(key);
      return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
    },
    async set(key: string, value: unknown): Promise<void> {
      if (!persistence) return;
      // y-indexeddb types the value as a primitive, so encode rather than
      // relying on structured clone working for whatever we pass.
      await persistence.set(key, JSON.stringify(value));
    },
  };
}
