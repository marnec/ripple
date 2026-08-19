import { vi, type Mock } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";

/**
 * Stand-ins for the three things a collaborative surface reaches for that a
 * test environment has no business really doing: a WebSocket provider, an
 * IndexedDB database, and Convex.
 *
 * These live in one module because they were previously declared once per test
 * file, and the copies had already diverged — the document-collaboration copy
 * grew a `sync()` the connection-policy copy spelled `connectAndSync()`, and
 * only one of the three recorded persistence instances at all. A fake is an
 * adapter like any other: two of them is two implementations to keep honest.
 *
 * Import it from a test with `vi.mock`'s async factory form, which runs late
 * enough to import a real module:
 *
 * ```ts
 * vi.mock("y-partyserver/provider", async () => ({
 *   default: (await import("@/test/collab-fakes")).FakeProvider,
 * }));
 * ```
 */

/** A room's offline cache, keyed by IndexedDB database name. */
export const cache = new Map<string, (doc: Y.Doc) => void>();

/** Every persistence instance built, so a test can assert on teardown. */
export const persistenceInstances: { name: string; destroyed: boolean }[] = [];

/** Stands in for `useConvex().query`. */
export const convexQuery: Mock = vi.fn();

/**
 * How the collaboration token behaves. Held in an object rather than exported
 * directly so a test can replace the behaviour after the mock is bound —
 * including making it never resolve.
 */
export const mint = {
  run: async (): Promise<{ token: string; roomId: string }> => ({
    token: "t",
    roomId: "doc-doc-1",
  }),
};

type ProviderOptions = { params: () => Promise<{ token: string }> };

/**
 * A `YProvider` that never opens a socket. Tests drive it: `open()` raises the
 * status, `connectAndSync()` takes it all the way to a synced room, `send()`
 * delivers a server protocol frame.
 */
export class FakeProvider {
  static instances: FakeProvider[] = [];

  shouldConnect = true;
  destroyed = false;
  ws: { addEventListener: (t: string, fn: (e: MessageEvent) => void) => void } | null = null;
  awareness: Awareness;
  readonly host: string;
  readonly room: string;
  readonly options: ProviderOptions | undefined;

  private handlers = new Map<string, Set<(...args: never[]) => void>>();
  private socketListeners: ((e: MessageEvent) => void)[] = [];

  constructor(host: string, room: string, doc: Y.Doc, options?: ProviderOptions) {
    this.host = host;
    this.room = room;
    this.options = options;
    this.awareness = new Awareness(doc);
    FakeProvider.instances.push(this);
  }

  on(event: string, handler: (...args: never[]) => void) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (...args: never[]) => void) {
    this.handlers.get(event)?.delete(handler);
  }

  destroy() {
    this.destroyed = true;
    this.awareness.destroy();
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  /** Report a completed sync without touching the socket status. */
  sync() {
    this.emit("sync", true);
  }

  /** Open the socket and sync — the happy path. */
  connectAndSync() {
    this.open();
    this.sync();
  }

  open() {
    this.ws = { addEventListener: (_t, fn) => this.socketListeners.push(fn) };
    this.emit("status", { status: "connected" });
  }

  close() {
    this.emit("status", { status: "disconnected" });
  }

  /** Deliver a server protocol frame (permission_revoked / auth_error). */
  send(payload: unknown) {
    for (const listener of [...this.socketListeners]) {
      listener({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }
}

/**
 * An `IndexeddbPersistence` that replays whatever `cache` holds for its
 * database name. `synced` fires for an empty database too — it means "the
 * replay finished", not "there was something to replay", which is exactly why
 * a surface cannot treat it as proof the device knows this room.
 */
export class FakeIndexeddbPersistence {
  private handlers: (() => void)[] = [];
  private record: { name: string; destroyed: boolean };
  /** The `custom` object store the room store rides in. */
  private custom = new Map<string, string>();

  constructor(name: string, doc: Y.Doc) {
    this.record = { name, destroyed: false };
    persistenceInstances.push(this.record);
    queueMicrotask(() => {
      cache.get(name)?.(doc);
      this.handlers.forEach((handler) => handler());
    });
  }

  on(event: string, handler: () => void) {
    if (event === "synced") this.handlers.push(handler);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.custom.get(key) ?? null);
  }

  set(key: string, value: string): Promise<string> {
    this.custom.set(key, value);
    return Promise.resolve(value);
  }

  destroy() {
    this.record.destroyed = true;
    return Promise.resolve();
  }
}

/** Pretend this device has an offline cache for `name` holding `update`. */
export function seedCache(name: string, update: Uint8Array) {
  cache.set(name, (doc) => Y.applyUpdate(doc, update));
}

/** A Yjs update carrying some content, as a stand-in for a real document. */
export function contentUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

/** A cached BlockNote document, as a previous visit would have left it. */
export function cacheDocument(roomId: string, text: string) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
  const group = new Y.XmlElement("blockGroup");
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", "cached");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  container.insert(0, [paragraph]);
  group.insert(0, [container]);
  fragment.insert(0, [group]);
  seedCache(roomId, Y.encodeStateAsUpdate(doc));
}

/**
 * Return every fake to its starting state. Convex is left saying it knows
 * nothing, which is the answer that leaves a replica unhydrated.
 */
export function resetCollabFakes() {
  FakeProvider.instances.length = 0;
  persistenceInstances.length = 0;
  cache.clear();
  convexQuery.mockReset();
  convexQuery.mockResolvedValue({ status: "unavailable" });
  mint.run = async () => ({ token: "t", roomId: "doc-doc-1" });
}
