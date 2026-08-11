import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import YProvider from "y-partyserver/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  fetchCollaborationToken,
  invalidateCollaborationToken,
} from "@/lib/collaboration-token-cache";
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
  isLoading: boolean;
  isOffline: boolean;
  /** True once IndexedDB has replayed this room's offline cache. */
  isCacheLoaded: boolean;
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
  const [generation, setGeneration] = useState(0);

  const providerRef = useRef<YProvider | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(() => {
    if (!persistenceKey) return;

    const persistence = new IndexeddbPersistence(persistenceKey, yDoc);
    persistence.on("synced", () => setIsCacheLoaded(true));

    return () => {
      void persistence.destroy();
      setIsCacheLoaded(false);
    };
  }, [persistenceKey, yDoc]);

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
  // and airplane mode change it without ever closing the WebSocket.
  useEffect(() => {
    if (!enabled) return;

    const report = (event: ConnectionEvent) => {
      const { state: next, effects } = reduceConnection(policyRef.current, event);
      policyRef.current = next;
      dispatch(event);
      // The stale provider's socket is dead but the browser never closed it.
      if (effects.some((e) => e.type === "teardown")) {
        detach(providerRef.current);
        providerRef.current = null;
        setProvider(null);
      }
      if (effects.some((e) => e.type === "reconnect-after")) {
        setGeneration((n) => n + 1);
      }
    };

    const goOffline = () => report({ type: "browser-offline", at: Date.now() });
    const goOnline = () => report({ type: "browser-online", at: Date.now() });

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

  return {
    yDoc,
    provider,
    awareness: provider?.awareness ?? localAwareness,
    isCacheLoaded,
    ...status,
    // Loading means "nothing to show yet", not "no socket yet". A replayed
    // offline cache is something to show, so it ends the wait exactly as a
    // sync does — which is why every editor used to re-derive this itself.
    isLoading: status.isLoading && !isCacheLoaded,
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
