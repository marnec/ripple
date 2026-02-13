import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { ResourceType, ErrorCode } from "@shared/protocol";
import { ERROR_SEVERITY } from "@shared/protocol";

// Connection timeout: 4 seconds (within the 3-5s user decision range)
const CONNECTION_TIMEOUT = 4000;
// Max unsuccessful reconnects before giving up and recreating provider
const MAX_UNSUCCESSFUL_RECONNECTS = 5;
// Max provider recreations before stopping (prevents infinite auth storm)
const MAX_RECREATIONS = 3;
// Base delay for exponential backoff on provider recreation
const BASE_RECREATION_DELAY = 2000; // 2s, 4s, 8s

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
  const reconnectCheckRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);
  const recreationCountRef = useRef(0);

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

        // Create provider with dynamic params function that fetches fresh token on each connection/reconnection
        const newProvider = new YPartyKitProvider(host, roomId, yDoc, {
          connect: true,
          params: async () => {
            try {
              const { token } = await getToken({ resourceType, resourceId });
              return { token };
            } catch (err) {
              // If getToken fails (user logged out, no access), return empty token
              // Server will reject with AUTH_INVALID rather than provider throwing
              console.error("Failed to get collaboration token:", err);
              return { token: "" };
            }
          },
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

        // Handler for custom protocol messages (permission_revoked, etc.)
        const handleProtocolMessage = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "permission_revoked") {
              console.warn("Permission revoked:", msg.reason);
              if (!cancelled) {
                setIsConnected(false);
                newProvider.shouldConnect = false; // Prevent reconnection
                try {
                  newProvider.awareness.setLocalState(null);
                } catch {
                  // Awareness may already be destroyed
                }
                newProvider.destroy();
                providerRef.current = null;
                setProvider(null);
              }
            }
          } catch {
            // Not JSON — skip binary messages
          }
        };

        // Safety net: if too many reconnects fail (e.g. token fully expired),
        // destroy and recreate provider to get a fresh token via params().
        // Uses polling since connection-close has timing issues with y-partykit internals.
        reconnectCheckRef.current = setInterval(() => {
          if (cancelled || newProvider.wsconnected) {
            if (reconnectCheckRef.current) clearInterval(reconnectCheckRef.current);
            reconnectCheckRef.current = null;
            return;
          }
          if (newProvider.wsUnsuccessfulReconnects >= MAX_UNSUCCESSFUL_RECONNECTS) {
            if (reconnectCheckRef.current) clearInterval(reconnectCheckRef.current);
            reconnectCheckRef.current = null;

            // Check if we've exceeded max recreations
            if (recreationCountRef.current >= MAX_RECREATIONS) {
              console.warn(`Max provider recreations (${MAX_RECREATIONS}) reached — pausing reconnection`);
              setIsOffline(true);
              setIsLoading(false);
              return;
            }

            newProvider.shouldConnect = false;
            try {
              newProvider.awareness.setLocalState(null);
            } catch {
              // Awareness may already be destroyed
            }
            newProvider.destroy();
            providerRef.current = null;
            setProvider(null);

            if (!cancelled) {
              const delay = BASE_RECREATION_DELAY * Math.pow(2, recreationCountRef.current);
              recreationCountRef.current += 1;
              console.warn(`Recreating provider in ${delay}ms (attempt ${recreationCountRef.current}/${MAX_RECREATIONS})`);
              setTimeout(() => {
                if (!cancelled) {
                  setReconnectTrigger((prev) => prev + 1);
                }
              }, delay);
            }
          }
        }, 2000);

        newProvider.on("sync", (synced: boolean) => {
          if (!cancelled) {
            isConnectedRef.current = synced;
            setIsConnected(synced);
            if (synced) {
              recreationCountRef.current = 0; // Reset recreation counter on successful connection
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
          if (!cancelled) {
            const connected = status === "connected";
            isConnectedRef.current = connected;
            setIsConnected(connected);

            if (connected) {
              // Connection succeeded - clear offline state
              setIsOffline(false);

              // Attach message listener when connected
              if (newProvider.ws) {
                newProvider.ws.addEventListener("message", handleProtocolMessage);
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
      if (reconnectCheckRef.current) {
        clearInterval(reconnectCheckRef.current);
        reconnectCheckRef.current = null;
      }
      if (providerRef.current) {
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
      // Destroy the stale provider (its WebSocket is dead but Chrome didn't close it)
      if (providerRef.current) {
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
