import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { ResourceType, ErrorCode } from "@shared/protocol";
import { ERROR_SEVERITY } from "@shared/protocol";

export function useYjsProvider(opts: {
  resourceType: ResourceType;
  resourceId: string;
  enabled?: boolean;
}) {
  const { resourceType, resourceId, enabled = true } = opts;
  const getToken = useAction(api.collaboration.getCollaborationToken);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled);
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);

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
            setIsConnected(synced);
            setIsLoading(false);
          }
        });

        newProvider.on("status", ({ status }: { status: string }) => {
          if (!cancelled) {
            setIsConnected(status === "connected");

            // Attach message listener when connected
            if (status === "connected" && newProvider.ws) {
              newProvider.ws.addEventListener("message", handleProtocolMessage);
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

  return { yDoc, provider, isConnected, isLoading };
}
