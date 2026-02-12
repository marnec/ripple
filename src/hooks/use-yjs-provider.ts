import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { ResourceType, ErrorCode } from "@shared/protocol";
import { ERROR_SEVERITY } from "@shared/protocol";

// Connection timeout: 4 seconds (within the 3-5s user decision range)
const CONNECTION_TIMEOUT = 4000;

export function useYjsProvider(opts: {
  resourceType: ResourceType;
  resourceId: string;
  enabled?: boolean;
}) {
  const { resourceType, resourceId, enabled = true } = opts;
  const getToken = useAction(api.collaboration.getCollaborationToken);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isOffline, setIsOffline] = useState(false);
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);

  // Create stable Y.Doc per resourceId
  const yDoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const connect = async () => {
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
                newProvider.destroy();
                providerRef.current = null;
                setProvider(null);
              }
            }
          } catch {
            // Not JSON — skip binary messages
          }
        };

        newProvider.on("sync", (synced: boolean) => {
          if (!cancelled) {
            isConnectedRef.current = synced;
            setIsConnected(synced);
            if (synced) {
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
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      setProvider(null);
    };
  }, [resourceType, resourceId, enabled, yDoc, getToken]);

  // Cleanup yDoc on unmount or resourceId change
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  return { yDoc, provider, isConnected, isLoading, isOffline };
}
