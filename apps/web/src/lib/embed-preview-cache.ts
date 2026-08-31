/**
 * What this device last saw of the resources a document embeds.
 *
 * A document paints from its own offline cache the moment it is opened, but
 * every embed inside it used to wait on a Convex round trip before it could
 * show anything — so the text arrived instantly and the cells and quoted
 * blocks inside it popped in a second later, on every single load. Diagram
 * embeds never had that problem because they read the diagram's own IndexedDB
 * replica. This is the same idea for the two embeds that have no replica to
 * read: keep the tiny projection the server sends, and render it immediately
 * next time.
 *
 * Deliberately its own database rather than a key in the referenced room's
 * cache (`room-store.ts`): reading a key out of that store means opening the
 * room's whole Yjs document, which for a large spreadsheet costs far more than
 * the handful of cells the embed is going to show. The price of that choice is
 * that these entries are not evicted with the room, so nothing here may be
 * treated as authoritative — it is what we show for the ~100ms before the
 * server answers, and the server's answer always replaces it.
 */

const DB_NAME = "ripple-embed-previews";
const STORE = "previews";
const DB_VERSION = 1;

/** Entries untouched for this long are dropped the next time the DB opens. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface StoredEntry {
  value: unknown;
  savedAt: number;
}

/**
 * Session-lifetime mirror of everything read or written. It is what makes a
 * remount synchronous: the IndexedDB read only ever happens once per key per
 * page load, and re-opening a document you were just in paints from memory
 * with no async gap at all.
 */
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

/** Drop entries for embeds this device has not looked at in a month. */
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
 * The value already in memory for this key, without touching IndexedDB.
 *
 * Answers only for a key this session has already saved or loaded, which is
 * what makes it worth having: it lets a remount paint on its first render
 * instead of after an await. It is an optimisation over `loadEmbedPreview`,
 * never a substitute — a caller that only calls this will miss everything
 * stored by previous page loads.
 */
export function readEmbedPreviewSync<T>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

/**
 * The stored value for this key, from memory or from IndexedDB.
 * Resolves to `null` when nothing has ever been kept for it.
 */
export async function loadEmbedPreview<T>(key: string): Promise<T | null> {
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
 * Keep a value for this key. Writing is fire-and-forget on purpose: the
 * caller is rendering the value it just passed in, and nothing it does next
 * depends on the write having landed.
 */
export function saveEmbedPreview(key: string, value: unknown): void {
  // A reactive query re-delivers the same projection on every unrelated push
  // to the same document, so compare before writing rather than churning
  // IndexedDB once per keystroke somebody else makes.
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

/** Test seam: forget everything this session has cached in memory. */
export function clearEmbedPreviewMemory(): void {
  memory.clear();
}

export function cellPreviewKey(spreadsheetId: string, stableRef: string): string {
  return `cell:${spreadsheetId}:${stableRef}`;
}

export function blockPreviewKey(documentId: string, blockId: string): string {
  return `block:${documentId}:${blockId}`;
}

// ---------------------------------------------------------------------------
// The two projections a document embed renders from
// ---------------------------------------------------------------------------

/** The projection of one referenced cell or range. */
export interface CellPreview {
  values: string[][];
  updatedAt: number;
  cellRef: string;
  stableRef: string;
  orphan?: boolean;
}

/** The projection of one referenced document block. */
export interface BlockRefPreview {
  blockType: string;
  textContent: string;
  updatedAt: number;
}

/**
 * Record what the picker was showing at the moment an embed was inserted.
 *
 * The cache row this is a copy of does not exist yet — the mutation that
 * creates it is still in flight, and the action that fills it in has not run —
 * so for the first second of an embed's life this is the only thing anyone
 * could render it from. Everything about it is provisional and gets replaced
 * by the server's own projection as soon as one arrives.
 */
export function seedCellPreview(
  spreadsheetId: string,
  stableRef: string,
  cellRef: string,
  values: string[][],
): void {
  saveEmbedPreview(cellPreviewKey(spreadsheetId, stableRef), {
    values,
    cellRef,
    stableRef,
    orphan: false,
    updatedAt: Date.now(),
  } satisfies CellPreview);
}

/** The block-embed counterpart of {@link seedCellPreview}. */
export function seedBlockPreview(
  documentId: string,
  blockId: string,
  blockType: string,
  textContent: string,
): void {
  saveEmbedPreview(blockPreviewKey(documentId, blockId), {
    blockType,
    textContent,
    updatedAt: Date.now(),
  } satisfies BlockRefPreview);
}
