import { useEffect, useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import {
  loadCachedQuery,
  queryCacheKey,
  readCachedQuerySync,
  saveCachedQuery,
} from "@/lib/query-cache";

export interface CachedAnswer<T> {
  /** What to render: the server's answer, or the copy this device kept. */
  value: T | undefined;
  /**
   * Whether `value` came from the server on this page load. False means it is
   * a stored copy — fine to show, but nothing that would *change* what it
   * describes should be offered over it, because the server is not answering.
   *
   * A live `null` counts as live: only the server can report that something
   * is gone, and the copy we kept of it must not paper over that.
   */
  isLive: boolean;
}

/**
 * The last value seen under `key`, kept in the query cache
 * (`lib/query-cache.ts`), served whenever `live` has no answer yet.
 *
 * `use-room-cached.ts` is this same hook for one room's own store. This one
 * is keyed rather than scoped, because the answers it keeps — the sidebar,
 * the list pages — are not about any one room.
 *
 * Pass `null` as the key to keep nothing and serve nothing, for the same
 * reason a query takes `"skip"`.
 */
export function useCachedValue<T>(key: string | null, live: T | undefined): CachedAnswer<T> {
  const [cached, setCached] = useState<T | undefined>(() =>
    key === null ? undefined : readCachedQuerySync<T>(key),
  );

  // A value cached under one key says nothing about the next. Reset while
  // rendering (React's "adjust state during render" idiom) so the first render
  // after a switch already shows the right key's copy — or nothing — instead
  // of the previous key's answer.
  const [cachedKey, setCachedKey] = useState(key);
  if (cachedKey !== key) {
    setCachedKey(key);
    setCached(key === null ? undefined : readCachedQuerySync<T>(key));
  }

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    void loadCachedQuery<T>(key).then((stored) => {
      if (!cancelled && stored !== null) setCached(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Keep every real answer, so a later visit that cannot reach the server has
  // something to show. A `null` is not content and is deliberately not stored.
  useEffect(() => {
    if (key === null || live === undefined || live === null) return;
    saveCachedQuery(key, live);
  }, [key, live]);

  const isLive = live !== undefined;
  return { value: isLive ? live : cached, isLive };
}

/**
 * `useQuery`, with the last answer kept on this device and served while the
 * subscription has none — on a cold load with no network, or on the first
 * visit to a page in a session that has since gone offline.
 *
 * Wraps the convex-helpers cached `useQuery`, so a component switching to this
 * keeps the five-minute subscription hand-off it had.
 */
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): CachedAnswer<FunctionReturnType<Query>> {
  const live = useQuery(query, args);
  const key = args === "skip" ? null : queryCacheKey(query, args);
  return useCachedValue<FunctionReturnType<Query>>(key, live);
}
