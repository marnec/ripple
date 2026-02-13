import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { ResourceType, ErrorCode } from "@shared/protocol";
import { ERROR_SEVERITY } from "@shared/protocol";

// Connection timeout: 4 seconds (within the 3-5s user decision range)
const CONNECTION_TIMEOUT = 4000;
// Max short-lived connections (< 2s) within RAPID_WINDOW before triggering storm detection
const MAX_RAPID_DISCONNECTS = 3;
// Time window for rapid-disconnect detection
const RAPID_DISCONNECT_WINDOW = 15_000; // 15 seconds
// Max provider recreations before stopping (prevents infinite auth storm)
const MAX_RECREATIONS = 3;
// Base delay for exponential backoff on provider recreation
const BASE_RECREATION_DELAY = 2000; // 2s, 4s, 8s
// A connection shorter than this is considered a failure (auth rejected etc.)
const SHORT_LIVED_THRESHOLD = 2000;

export function useYjsProvider(opts: {
  resourceType: ResourceType;
  resourceId: string;
  enabled?: boolean;
}) {
  const { resourceType, resourceId, enabled = true } = opts;
  const { isAuthenticated } = useConvexAuth();
  const getToken = useAction(api.collaboration.getCollaborationToken);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isOffline, setIsOffline] = useState(false);
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);
  const recreationCountRef = useRef(0);
  const lastConnectTimeRef = useRef(0);
  const rapidDisconnectsRef = useRef<number[]>([]);

  // Create stable Y.Doc per resourceId
  const yDoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      return;
    }

    let cancelled = false;

    const connect = async () => {
      // Check navigator.onLine before attempting connection
      if (!navigator.onLine) {
        console.warn("Browser is offline - skipping connection attempt");
        setIsOffline(true);
        setIsLoading(false);
        return;
      }

      try {
        // Compute roomId outside params function (YPartyKitProvider needs it at construction)
        const roomId = `${resourceType}-${resourceId}`;
        const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

        // Fetch token BEFORE creating provider. If token fetch fails, there's no point
        // creating a WebSocket connection that will just be rejected by the server.
        let initialToken: string;
        try {
          const result = await getToken({ resourceType, resourceId });
          initialToken = result.token;
        } catch (err) {
          console.error("Failed to get collaboration token:", err);
          if (cancelled) return;
          setIsOffline(true);
          setIsLoading(false);
          // Schedule retry with backoff
          if (recreationCountRef.current < MAX_RECREATIONS) {
            const delay = BASE_RECREATION_DELAY * Math.pow(2, recreationCountRef.current);
            recreationCountRef.current += 1;
            console.warn(`Token fetch failed, retrying in ${delay}ms (attempt ${recreationCountRef.current}/${MAX_RECREATIONS})`);
            setTimeout(() => {
              if (!cancelled) {
                setReconnectTrigger((prev) => prev + 1);
              }
            }, delay);
          } else {
            console.warn(`Max retries (${MAX_RECREATIONS}) reached — staying offline`);
          }
          return;
        }

        if (cancelled) return;

        // Guard flag: prevent triggerRecreation from firing multiple times per provider
        // (auth_error handler + status:disconnected can both trigger it)
        let recreationTriggered = false;

        // Create provider with pre-fetched token (static params).
        // IMPORTANT: Do NOT use async params function here. y-partykit's connect()
        // resolves async params in a .then() that calls super.connect() which sets
        // shouldConnect=true. If destroy() runs before .then() resolves, the .then()
        // creates a zombie WebSocket that is never cleaned up (awareness listener
        // already removed by destroy), causing ghost avatars in the facepile.
        // Tokens are reusable for 5 minutes, so y-partykit's auto-reconnect works
        // with the same token. For expiration beyond 5min, auth_error → triggerRecreation
        // handles it by creating a fresh provider with a new token.
        const newProvider = new YPartyKitProvider(host, roomId, yDoc, {
          connect: true,
          params: { token: initialToken },
        });

        if (cancelled) {
          newProvider.destroy();
          return;
        }

        providerRef.current = newProvider;
        setProvider(newProvider);

        // Start connection timeout - if not connected after CONNECTION_TIMEOUT, consider offline
        timeoutRef.current = setTimeout(() => {
          if (!cancelled && !isConnectedRef.current) {
            console.warn(`PartyKit connection timeout after ${CONNECTION_TIMEOUT}ms - falling back to offline mode`);
            setIsOffline(true);
            setIsLoading(false);
          }
        }, CONNECTION_TIMEOUT);

        // Handler for custom protocol messages (permission_revoked, auth_error, etc.)
        const handleProtocolMessage = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "permission_revoked") {
              console.warn("Permission revoked:", msg.reason);
              if (!cancelled) {
                destroyProvider(newProvider);
              }
            } else if (msg.type === "auth_error") {
              // Server rejected auth — stop reconnecting immediately to avoid storm
              console.warn("Auth error from server:", msg.code);
              if (!cancelled && !recreationTriggered) {
                triggerRecreation(newProvider);
              }
            }
          } catch {
            // Not JSON — skip binary messages
          }
        };

        // Destroy provider permanently (permission revoked — no recreation)
        const destroyProvider = (p: YPartyKitProvider) => {
          recreationTriggered = true; // Prevent any other triggers
          setIsConnected(false);
          p.shouldConnect = false;
          try { p.awareness.setLocalState(null); } catch { /* already destroyed */ }
          p.destroy();
          providerRef.current = null;
          setProvider(null);
        };

        // Destroy and recreate provider with exponential backoff.
        // Guarded by recreationTriggered to prevent double-fire from
        // auth_error + status:disconnected both calling this.
        const triggerRecreation = (p: YPartyKitProvider) => {
          if (recreationTriggered) return;
          recreationTriggered = true;

          p.shouldConnect = false;
          try { p.awareness.setLocalState(null); } catch { /* already destroyed */ }
          p.destroy();
          providerRef.current = null;
          setProvider(null);

          if (recreationCountRef.current >= MAX_RECREATIONS) {
            console.warn(`Max provider recreations (${MAX_RECREATIONS}) reached — staying offline`);
            setIsOffline(true);
            setIsLoading(false);
            return;
          }

          const delay = BASE_RECREATION_DELAY * Math.pow(2, recreationCountRef.current);
          recreationCountRef.current += 1;
          console.warn(`Recreating provider in ${delay}ms (attempt ${recreationCountRef.current}/${MAX_RECREATIONS})`);
          setTimeout(() => {
            if (!cancelled) {
              rapidDisconnectsRef.current = [];
              setReconnectTrigger((prev) => prev + 1);
            }
          }, delay);
        };

        newProvider.on("sync", (synced: boolean) => {
          if (!cancelled) {
            isConnectedRef.current = synced;
            setIsConnected(synced);
            if (synced) {
              recreationCountRef.current = 0; // Reset counters on successful sync
              rapidDisconnectsRef.current = [];
              // Connection succeeded - clear timeout and offline state
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setIsOffline(false);
              setIsLoading(false);
            }
          }
        });

        newProvider.on("status", ({ status }: { status: string }) => {
          if (cancelled) return;

          if (status === "connected") {
            isConnectedRef.current = true;
            setIsConnected(true);
            setIsOffline(false);
            lastConnectTimeRef.current = Date.now();

            // Attach message listener when connected
            if (newProvider.ws) {
              newProvider.ws.addEventListener("message", handleProtocolMessage);
            }
          } else if (status === "disconnected") {
            isConnectedRef.current = false;
            setIsConnected(false);

            // Detect rapid connect→disconnect cycles (auth storm indicator).
            // wsUnsuccessfulReconnects resets on ws.onopen (101 Switching Protocols)
            // so it never reaches the threshold — use time-based detection instead.
            const now = Date.now();
            const connectionDuration = now - lastConnectTimeRef.current;

            if (lastConnectTimeRef.current > 0 && connectionDuration < SHORT_LIVED_THRESHOLD) {
              rapidDisconnectsRef.current.push(now);
              // Prune entries outside the window
              const cutoff = now - RAPID_DISCONNECT_WINDOW;
              rapidDisconnectsRef.current = rapidDisconnectsRef.current.filter(t => t > cutoff);

              if (rapidDisconnectsRef.current.length >= MAX_RAPID_DISCONNECTS && !recreationTriggered) {
                console.warn(
                  `Detected ${rapidDisconnectsRef.current.length} rapid disconnects in ` +
                  `${RAPID_DISCONNECT_WINDOW / 1000}s — stopping reconnection storm`
                );
                triggerRecreation(newProvider);
              }
            }
          }
        });
      } catch (err) {
        console.error("Failed to connect to collaboration server:", err);

        // Check if error contains a recognized error code
        if (err && typeof err === "object" && "code" in err) {
          const errorCode = err.code as ErrorCode;
          const severity = ERROR_SEVERITY[errorCode];
          console.error(`Collaboration error: ${errorCode} (${severity})`);
        }

        if (!cancelled) setIsLoading(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (providerRef.current) {
        // Stop auto-reconnect before cleanup to prevent y-partykit from
        // creating new connections during the destroy sequence
        providerRef.current.shouldConnect = false;
        // Clear awareness state before destroying so other clients
        // immediately remove this user's presence (prevents ghost avatars
        // when rapidly switching between documents)
        try {
          providerRef.current.awareness.setLocalState(null);
        } catch {
          // Awareness may already be destroyed
        }
        providerRef.current.destroy();
        providerRef.current = null;
      }
      setProvider(null);
    };
  }, [resourceType, resourceId, enabled, yDoc, getToken, reconnectTrigger, isAuthenticated]);

  // Listen for browser offline/online events (independent of WebSocket close events)
  // This catches DevTools offline mode and airplane mode changes that don't close WebSockets
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleOffline = () => {
      console.warn("Browser offline event detected");
      setIsOffline(true);
      setIsConnected(false);
      isConnectedRef.current = false;
    };

    const handleOnline = () => {
      console.info("Browser online event detected - triggering reconnection");
      recreationCountRef.current = 0; // Reset on explicit online event
      rapidDisconnectsRef.current = []; // Clean slate for storm detection
      // Destroy the stale provider (its WebSocket is dead but Chrome didn't close it)
      if (providerRef.current) {
        providerRef.current.shouldConnect = false;
        try {
          providerRef.current.awareness.setLocalState(null);
        } catch {
          // Awareness may already be destroyed
        }
        providerRef.current.destroy();
        providerRef.current = null;
      }
      setProvider(null);
      setIsOffline(false);
      setIsLoading(true);
      // Increment reconnectTrigger to force the connection useEffect to re-run
      setReconnectTrigger((prev) => prev + 1);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [enabled]);

  // Cleanup yDoc on unmount or resourceId change
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  return { yDoc, provider, isConnected, isLoading, isOffline };
}
