/**
 * The last answer this device saw for a Convex query.
 *
 * A collaborative resource paints offline from its own Yjs replica, and its
 * metadata from the room store beside it — but the sidebar and the list pages
 * are not rooms. They are the answers to a handful of workspace-scoped queries,
 * and offline those queries never answer, so a device that knew every channel
 * a minute ago showed none of them after a reload. This keeps those answers,
 * one IndexedDB row per (function, args), so the shell can render what it last
 * knew while the server is unreachable.
 *
 * The rule for what is in here is the room store's rule: an answer is what
 * the server said, kept verbatim, replaced the moment the server says
 * something else. Nothing here is authoritative. A component reading a stored
 * answer gets it flagged `isLive: false` (`use-cached-query.ts`) and must not
 * offer anything that would *change* the resource over it.
 *
 * Every row belongs to the signed-in session: the whole store is emptied when
 * the session ends (`App.tsx`), so a second account on the same browser never
 * reads the first one's sidebar, and there is no per-user key to get wrong.
 * Leaving a workspace forgets that workspace's rows (`forgetCachedQueries`).
 *
 * Modelled on `embed-preview-cache.ts`: an in-memory mirror makes a remount
 * synchronous, IndexedDB makes a reload survivable, and a browser that refuses
 * IndexedDB (private mode) degrades to the mirror alone.
 */
import { getFunctionName, type FunctionReference } from "convex/server";

const DB_NAME = "ripple-query-cache";
const STORE = "answers";
const DB_VERSION = 1;

/** Answers untouched for this long are dropped the next time the DB opens. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface StoredEntry {
  value: unknown;
  savedAt: number;
}

const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private-mode browsers throw here rather than failing the request.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      resolve(db);
      prune(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Drop answers this device has not refreshed in a month. */
function prune(db: IDBDatabase): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const entry = cursor.value as StoredEntry | undefined;
      if (!entry || typeof entry.savedAt !== "number" || entry.savedAt < cutoff) {
        cursor.delete();
      }
      cursor.continue();
    };
  } catch {
    // Pruning is housekeeping; a failure must never affect what is rendered.
  }
}

/**
 * `JSON.stringify` with object keys in a fixed order and `undefined` members
 * dropped, so `{ a, b }` and `{ b, a }` — and `{ a, b: undefined }` — name the
 * same cache row. Convex ignores both differences too.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The row for one query invocation: function name plus its arguments. */
export function queryCacheKey(
  query: FunctionReference<"query">,
  args: Record<string, unknown>,
): string {
  return `${getFunctionName(query)}|${stableStringify(args)}`;
}

/**
 * The answer already in memory for this key, without touching IndexedDB.
 * Answers only for a key this page load has already saved or loaded — an
 * optimisation that lets a remount paint on its first render, never a
 * substitute for `loadCachedQuery`.
 */
export function readCachedQuerySync<T>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

/** The stored answer for this key, or `null` when none was ever kept. */
export async function loadCachedQuery<T>(key: string): Promise<T | null> {
  const inMemory = memory.get(key);
  if (inMemory !== undefined) return inMemory as T;

  const db = await openDb();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as StoredEntry | undefined;
        if (entry === undefined) {
          resolve(null);
          return;
        }
        // A read is a use: refresh the timestamp so an answer this device
        // keeps coming back to is not pruned out from under it.
        memory.set(key, entry.value);
        resolve(entry.value as T);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Keep an answer. Fire-and-forget: the caller is rendering the value it just
 * passed in, and nothing it does next depends on the write having landed.
 */
export function saveCachedQuery(key: string, value: unknown): void {
  // A reactive query re-delivers on every push that touches its read set,
  // most of which leave the answer unchanged. Compare before writing rather
  // than churning IndexedDB on every message somebody else sends.
  const previous = memory.get(key);
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(value)) {
    return;
  }
  memory.set(key, value);
  void openDb().then((db) => {
    if (!db) return;
    try {
      const entry: StoredEntry = { value, savedAt: Date.now() };
      db.transaction(STORE, "readwrite").objectStore(STORE).put(entry, key);
    } catch {
      // Quota or a closed connection — the in-memory copy still stands.
    }
  });
}

/**
 * Forget every answer whose key matches. Keys embed the query's arguments, so
 * "everything about workspace X" is `key.includes(workspaceId)`.
 */
export async function forgetCachedQueries(matches: (key: string) => boolean): Promise<void> {
  for (const key of [...memory.keys()]) {
    if (matches(key)) memory.delete(key);
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const cursorRequest = tx.objectStore(STORE).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (typeof cursor.key === "string" && matches(cursor.key)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Forget everything. The session ending is the one event that makes every
 * row wrong at once: the next person to sign in on this browser must not see
 * the previous one's workspaces.
 */
export async function clearQueryCache(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Test seam: forget the in-memory mirror only, as a reload would. */
export function clearQueryCacheMemory(): void {
  memory.clear();
}
