import { useConvex } from "convex/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import YProvider from "y-partyserver/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import {
  fetchCollaborationToken,
  invalidateCollaborationToken,
} from "@/lib/collaboration-token-cache";
import { SNAPSHOT_ORIGIN } from "@/lib/yjs-origins";
import { startActivityReporting } from "@/lib/awareness-activity";
import { startAwarenessHeartbeat } from "@/lib/awareness-heartbeat";
import {
  connectionStatus,
  initialConnectionState,
  reduceConnection,
  type ConnectionEffect,
  type ConnectionEvent,
} from "@/lib/collab/connection-policy";
import type { CollabRoom } from "@/lib/collab/room";
import { createRoomStore, type RoomStore } from "@/lib/collab/room-store";
import { isKnowledge, readStoredState } from "@/lib/collab/stored-state";
import { guardAuthFailure } from "@/lib/yjs-auth-guard";

/** How long a provider may take to sync before we show the offline state. */
const CONNECTION_TIMEOUT = 4_000;

/**
 * How this client proves it may enter a room.
 *
 * This is the only thing that differed between the member and guest provider
 * hooks, which is why they were near-identical files that nonetheless drifted:
 * only one of them ever grew storm detection. Making the credential a parameter
 * leaves exactly one lifecycle.
 */
export interface CollabSession {
  /** Identifies the session for token caching and for keying the Y.Doc. */
  key: string;
  /**
   * The room, when the client already knows it. Guests don't: the server
   * resolves the share to a room while minting the token. A session with no
   * room also gets no IndexedDB cache — a guest's device shouldn't retain the
   * contents of a link that may be revoked.
   */
  room: CollabRoom | null;
  /** Mint a fresh token. Called on first connect and on every reconnect. */
  mint: () => Promise<{ token: string; roomId: string }>;
}

export interface CollaborativeDoc {
  yDoc: Y.Doc;
  provider: YProvider | null;
  /**
   * Always present. Before the provider connects (and while offline) this is a
   * local Awareness over the same doc, so editors can bind at mount instead of
   * waiting for a socket.
   */
  awareness: Awareness;
  isConnected: boolean;
  /** Still trying to reach the room: neither connected nor given up. */
  isConnecting: boolean;
  isLoading: boolean;
  isOffline: boolean;
  /** True once IndexedDB has replayed this room's offline cache. */
  isCacheLoaded: boolean;
  /**
   * Whether this replica holds the room's state — from a completed sync, an
   * offline cache that actually had something in it, a stored snapshot, or
   * Convex confirming that nothing has ever been stored for the resource
   * (which is knowledge about its contents: it has none).
   *
   * This is the difference between "this document is empty" and "I have no
   * idea what is in this document", which a Y.Doc cannot express on its own:
   * both are a doc with no content. Authoring into the second one is what
   * produces a rival root node that destroys the real content on merge, so no
   * editor may bind for writing until this is true.
   */
  isHydrated: boolean;
  /**
   * Local storage scoped to this room, sharing the room's IndexedDB database.
   * Null when the room keeps no cache at all — a guest's does not.
   */
  roomStore: RoomStore | null;
}

/** Whether a Y.Doc holds any state at all (from any client, including us). */
function hasState(yDoc: Y.Doc): boolean {
  // An empty state vector encodes to a single zero byte; anything longer means
  // at least one client's clock is represented. Public API, unlike `store`.
  return Y.encodeStateVector(yDoc).length > 1;
}

/**
 * Owns "a synced Y.Doc for resource X": the document itself, the provider,
 * offline persistence, awareness, and the teardown of all four.
 *
 * Callers get a doc and a status. What they do with the doc — bind BlockNote,
 * bind Excalidraw, bind a spreadsheet — is theirs; none of the lifecycle is.
 */
export function useCollaborativeDoc({
  session,
  enabled = true,
}: {
  session: CollabSession;
  enabled?: boolean;
}): CollaborativeDoc {
  const [state, dispatch] = useReducer(applyEvent, undefined, initialConnectionState);
  // React owns `state` for rendering; this mirror is the policy's own view of
  // itself, so a burst of events in one tick (a socket that opens and syncs
  // synchronously) each sees the previous one's result rather than the state
  // as of the last render. Only ever touched from callbacks, never in render.
  const policyRef = useRef(state);
  const [provider, setProvider] = useState<YProvider | null>(null);
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);
  /** The offline cache replayed and it was not empty. */
  const [cacheHasState, setCacheHasState] = useState(false);
  /**
   * Convex told us what is persisted for this room: either it handed over a
   * snapshot, which we merged, or it confirmed there is none — and a resource
   * nothing has ever been stored for is one nobody has put content into.
   */
  const [storedStateKnown, setStoredStateKnown] = useState(false);
  const [generation, setGeneration] = useState(0);
  const convex = useConvex();

  // A snapshot restored for one room says nothing about the next one. Reset
  // while rendering (React's "adjust state during render" idiom) so the first
  // render of a new room already reads as unhydrated — an effect would leave
  // one render claiming we hold a document we have not looked at.
  const [snapshotRoomKey, setSnapshotRoomKey] = useState(session.key);
  if (snapshotRoomKey !== session.key) {
    setSnapshotRoomKey(session.key);
    if (storedStateKnown) setStoredStateKnown(false);
  }

  const providerRef = useRef<YProvider | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The connection effect's `report`, so the browser-connectivity effect can
   * reach it instead of owning a second copy.
   *
   * `report` closes over the per-attempt `cancelled` and `settled` flags, so it
   * cannot be hoisted out of that effect without turning both into refs. The
   * connectivity listeners outlive any one provider, so they cannot hold a copy
   * either — and when they did, that copy was a second interpreter: it carried
   * out two of the four effect kinds, discarded `reconnect-after`'s delay, and
   * could not set `settled`, so a provider it tore down went on reporting its
   * own death.
   *
   * Null whenever no connection attempt is live, which is exactly when a
   * connectivity event has nothing to act on.
   */
  const reportRef = useRef<((event: ConnectionEvent) => void) | null>(null);
  // The session object is rebuilt on every render by its caller; the connection
  // effect must key on `session.key`, not on that identity, or it would tear
  // the socket down every render.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const { key, room } = session;

  // One Y.Doc per session key. The key must be a dependency: the task detail
  // sheet stays mounted across task switches, so a doc memoized with `[]` would
  // be reused for every task and bleed one description into all of them.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a recreation key, not a value read by the factory
  const yDoc = useMemo(() => new Y.Doc(), [key]);

  // Awareness the editors can bind to before (and without) a provider.
  const localAwareness = useMemo(() => new Awareness(yDoc), [yDoc]);

  useEffect(() => {
    return () => {
      localAwareness.destroy();
      yDoc.destroy();
    };
  }, [yDoc, localAwareness]);

  // A new room starts from a clean policy. Without this, opening a document
  // whose access was revoked would leave the connection permanently `stopped`,
  // and the *next* document opened in the same mounted view would inherit that
  // verdict and never connect. Declared before the connection effect so it
  // runs first on a key change.
  useEffect(() => {
    policyRef.current = initialConnectionState();
    dispatch({ type: "reset", at: Date.now() });
  }, [key]);

  // Offline cache. Deliberately independent of the provider: content from a
  // previous visit should appear without waiting on a socket.
  const persistenceKey = enabled ? (room?.persistenceKey ?? null) : null;
  // Stable per room, and never state: the instance behind it comes and goes
  // with the effect below, but callers keep one object to depend on. The
  // memo is load-bearing, not an optimisation — `useRoomCached` treats a new
  // store identity as "different room" and drops what it had, so a store
  // rebuilt each render would never manage to show a cached value.
  const roomStore = useMemo(
    () => (persistenceKey ? createRoomStore() : null),
    [persistenceKey],
  );
  useEffect(() => {
    if (!persistenceKey) return;

    const persistence = new IndexeddbPersistence(persistenceKey, yDoc);
    roomStore?.attach(persistence);
    persistence.on("synced", () => {
      setIsCacheLoaded(true);
      // `synced` fires for an empty database too — it means "the replay is
      // finished", not "there was something to replay". Only a non-empty doc
      // proves this device has actually seen the room before.
      setCacheHasState(hasState(yDoc));
    });

    return () => {
      roomStore?.attach(null);
      void persistence.destroy();
      setIsCacheLoaded(false);
      setCacheHasState(false);
    };
  }, [persistenceKey, yDoc, roomStore]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    /** One provider gets at most one terminal decision. */
    let settled = false;

    const runEffects = (effects: ConnectionEffect[], target: YProvider | null) => {
      for (const effect of effects) {
        switch (effect.type) {
          case "clear-connect-timeout":
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            break;
          case "invalidate-token":
            invalidateCollaborationToken(key);
            break;
          case "teardown":
            settled = true;
            detach(target ?? providerRef.current);
            providerRef.current = null;
            setProvider(null);
            break;
          case "reconnect-after":
            setTimeout(() => {
              if (!cancelled) setGeneration((n) => n + 1);
            }, effect.delayMs);
            break;
        }
      }
    };

    /** Report an event to the policy and carry out whatever it decides. */
    const report = (event: ConnectionEvent, target: YProvider | null = null) => {
      if (cancelled) return;
      const { state: next, effects } = reduceConnection(policyRef.current, event);
      policyRef.current = next;
      dispatch(event);
      runEffects(effects, target);
    };

    // Reachable from the connectivity effect from here on. Set synchronously,
    // before `connect()` goes async, so an `online` event arriving while the
    // first token is still being minted is not dropped.
    reportRef.current = report;

    const connect = async () => {
      if (!navigator.onLine) {
        report({ type: "browser-offline", at: Date.now() });
        return;
      }

      let token: string;
      let roomId: string;
      try {
        const minted = await fetchCollaborationToken(key, () => sessionRef.current.mint());
        token = minted.token;
        roomId = minted.roomId;
      } catch (err) {
        console.error("Failed to mint a collaboration token:", err);
        report({ type: "token-failed", at: Date.now() });
        return;
      }

      if (cancelled) return;

      const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";
      // The first params() call replays the token we just minted; y-partyserver
      // re-evaluates params() on every reconnect, so later calls fetch a fresh
      // one — which is what covers the 5-minute token expiry window.
      let pendingToken: string | null = token;
      const newProvider = new YProvider(host, roomId, yDoc, {
        connect: true,
        params: async () => {
          if (pendingToken) {
            const replay = pendingToken;
            pendingToken = null;
            return { token: replay };
          }
          const { token: fresh } = await fetchCollaborationToken(key, () =>
            sessionRef.current.mint(),
          );
          return { token: fresh };
        },
      });

      if (cancelled) {
        newProvider.destroy();
        return;
      }

      providerRef.current = newProvider;
      setProvider(newProvider);

      timeoutRef.current = setTimeout(() => {
        report({ type: "connect-timed-out", at: Date.now() });
      }, CONNECTION_TIMEOUT);

      const handleProtocolMessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let message: { type?: string; reason?: string; code?: string };
        try {
          message = JSON.parse(event.data);
        } catch {
          return; // binary Yjs frame
        }
        if (settled) return;
        if (message.type === "permission_revoked") {
          console.warn("Collaboration permission revoked:", message.reason);
          report({ type: "permission-revoked", at: Date.now() }, newProvider);
        } else if (message.type === "auth_error") {
          console.warn("Collaboration auth error:", message.code);
          report({ type: "auth-rejected", at: Date.now() }, newProvider);
        }
      };

      // Close code 1008 — the server rejected us after the socket upgraded.
      guardAuthFailure(newProvider, () => {
        if (!settled) report({ type: "auth-rejected", at: Date.now() }, newProvider);
      });

      newProvider.on("sync", (synced: boolean) => {
        if (synced) report({ type: "synced", at: Date.now() }, newProvider);
      });

      newProvider.on("status", ({ status }: { status: string }) => {
        if (settled) return;
        if (status === "connected") {
          newProvider.ws?.addEventListener("message", handleProtocolMessage);
          report({ type: "status-connected", at: Date.now() }, newProvider);
        } else if (status === "disconnected") {
          report({ type: "status-disconnected", at: Date.now() }, newProvider);
        }
      });
    };

    void connect();

    return () => {
      cancelled = true;
      reportRef.current = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      detach(providerRef.current);
      providerRef.current = null;
      setProvider(null);
    };
    // `generation` is the reconnect trigger: bumping it rebuilds the provider.
    // Note what is NOT here — the connection status. Keying this effect on
    // whether we are connected is what made the guest hook destroy and rebuild
    // its provider on every status flip.
  }, [key, enabled, yDoc, generation]);

  // Browser connectivity is independent of the socket: DevTools offline mode
  // and airplane mode change it without ever closing the WebSocket. That is why
  // these listeners are not keyed on the provider — but reporting is still the
  // connection effect's job, so they hand the event over rather than deciding
  // anything themselves. See `reportRef`.
  useEffect(() => {
    if (!enabled) return;

    const goOffline = () =>
      reportRef.current?.({ type: "browser-offline", at: Date.now() });
    const goOnline = () =>
      reportRef.current?.({ type: "browser-online", at: Date.now() });

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [enabled]);

  // Restore the cursor-liveness loop the provider disables when it attaches.
  useEffect(() => {
    if (!provider) return;
    return startAwarenessHeartbeat(provider.awareness);
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    return startActivityReporting(provider.awareness);
  }, [provider]);

  const status = connectionStatus(state);
  const isHydrated = state.hasSynced || cacheHasState || storedStateKnown;

  // Third and last source of state: the snapshot the collaboration server
  // persists to Convex storage. Reached only when the other two have failed —
  // the room is unreachable and this device has no cache — which is exactly
  // the case that used to hand the user an empty, writable document.
  //
  // Merging server-authored bytes into the live doc is idempotent: they carry
  // the room's own client ids and clocks, so when the room does come back
  // there is nothing to reconcile, and any edit made in the meantime lands
  // inside the same structure rather than beside a rival copy of it.
  //
  // Convex is a separate service from the collaboration server, so this
  // recovers the common "PartyKit is down / slow, the network is fine" case.
  // With no network at all the query never resolves and we stay unhydrated,
  // which is the honest answer.
  //
  // `empty` hydrates us too, and that is the point of asking `getStoredState`
  // rather than `getSnapshotUrl`: an answer of "nothing has ever been stored
  // for this resource" is knowledge about its contents, not a failure to
  // obtain them. Without it a brand-new document reported itself unavailable
  // offline whenever the room was slow to answer — reachable, empty, and shown
  // as missing. Convex saying `unavailable` (no access, no such resource, a
  // broken blob) is not knowledge, and leaves us unhydrated.
  const snapshotAttemptedRef = useRef<string | null>(null);
  // Primitives, not `room`: the descriptor is rebuilt every render, and a dep
  // on its identity would run this effect's cleanup — cancelling the fetch —
  // on every render that happens while it is in flight.
  const snapshotResourceType = room?.resourceType ?? null;
  const snapshotResourceId = room?.resourceId ?? null;
  useEffect(() => {
    if (!enabled || !snapshotResourceType || !snapshotResourceId) return;
    if (!status.isOffline || isHydrated) return;
    if (snapshotAttemptedRef.current === key) return;
    snapshotAttemptedRef.current = key;

    let cancelled = false;
    void (async () => {
      const stored = await readStoredState(
        (args) => convex.query(api.snapshots.getStoredState, args),
        { resourceType: snapshotResourceType, resourceId: snapshotResourceId },
      );
      if (cancelled) return;

      if (stored.status === "failed") {
        console.error("Failed to read the stored state for this room:", stored.error);
        // Let a later attempt (a reconnect, a different room) try again.
        // `unavailable` deliberately does not do this: it is an answer.
        snapshotAttemptedRef.current = null;
        return;
      }
      if (!isKnowledge(stored)) return;
      if (stored.status === "content") {
        Y.applyUpdate(yDoc, stored.update, SNAPSHOT_ORIGIN);
      }
      setStoredStateKnown(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    snapshotResourceType,
    snapshotResourceId,
    status.isOffline,
    isHydrated,
    key,
    yDoc,
    convex,
  ]);

  return {
    yDoc,
    provider,
    awareness: provider?.awareness ?? localAwareness,
    isCacheLoaded,
    isHydrated,
    roomStore,
    ...status,
    // Loading means "nothing to show yet", not "no socket yet" — which is why
    // it is derived from `isConnecting` rather than being the same boolean.
    // Holding the room's state ends the wait exactly as a sync does; an
    // offline cache that replayed *nothing* does not.
    isLoading: status.isConnecting && !isHydrated,
  };
}

function applyEvent(state: Parameters<typeof reduceConnection>[0], event: ConnectionEvent) {
  return reduceConnection(state, event).state;
}

/**
 * Stop a provider without leaving a ghost behind: clear awareness first so
 * peers drop this cursor immediately, and stop auto-reconnect before destroying
 * so the provider can't open a new socket mid-teardown.
 */
function detach(provider: YProvider | null) {
  if (!provider) return;
  provider.shouldConnect = false;
  try {
    provider.awareness.setLocalState(null);
  } catch {
    // Awareness may already be destroyed.
  }
  provider.destroy();
}
