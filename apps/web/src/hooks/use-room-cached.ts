import { useEffect, useState } from "react";
import type { RoomStore } from "@/lib/collab/room-store";

/**
 * The last value a query gave for this room, kept beside the room's content.
 */
export function useRoomCached<T>(
  roomStore: RoomStore | null,
  key: string,
  live: T | undefined,
): T | undefined {
  const [cached, setCached] = useState<T | undefined>(undefined);

  // A value cached for one room says nothing about the next. Cleared while
  // rendering (React's "adjust state during render" idiom) rather than in an
  // effect, so the first render after a switch already shows nothing instead
  // of the previous room's answer.
  const [cachedFor, setCachedFor] = useState<RoomStore | null>(roomStore);
  const [cachedKey, setCachedKey] = useState(key);
  if (cachedFor !== roomStore || cachedKey !== key) {
    setCachedFor(roomStore);
    setCachedKey(key);
    if (cached !== undefined) setCached(undefined);
  }

  useEffect(() => {
    if (!roomStore) return;
    let cancelled = false;
    void roomStore.get<T>(key).then((stored) => {
      if (!cancelled && stored !== null) setCached(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [roomStore, key]);

  // Keep every real answer, so a later visit that cannot reach the server has
  // something to show. A `null` is not content and is deliberately not stored.
  useEffect(() => {
    if (!roomStore || live === undefined || live === null) return;
    void roomStore.set(key, live);
  }, [roomStore, key, live]);

  // `undefined` is the only "no answer yet". A live `null` means the resource
  // is gone, and must not be papered over with the copy we kept of it.
  return live !== undefined ? live : cached;
}
