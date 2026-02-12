import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";

type ResourceType = "doc" | "diagram" | "task";

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
        const { token, roomId } = await getToken({ resourceType, resourceId });
        if (cancelled) return;

        const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

        const newProvider = new YPartyKitProvider(host, roomId, yDoc, {
          connect: true,
          params: { token },
        });

        if (cancelled) {
          newProvider.destroy();
          return;
        }

        providerRef.current = newProvider;
        setProvider(newProvider);

        newProvider.on("sync", (synced: boolean) => {
          if (!cancelled) {
            setIsConnected(synced);
            setIsLoading(false);
          }
        });

        newProvider.on("status", ({ status }: { status: string }) => {
          if (!cancelled) {
            setIsConnected(status === "connected");
          }
        });
      } catch (err) {
        console.error("Failed to connect to collaboration server:", err);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId, enabled, yDoc]);

  // Cleanup yDoc on unmount or resourceId change
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  return { yDoc, provider, isConnected, isLoading };
}
