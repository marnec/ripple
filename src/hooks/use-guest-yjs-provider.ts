import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { ShareResourceType } from "@shared/shareTypes";
import { yjsResourceTypeForShare } from "@shared/shareTypes";
import { guardAuthFailure } from "@/lib/yjs-auth-guard";

const CONNECTION_TIMEOUT = 4000;
const BASE_RECREATION_DELAY = 2000;
const MAX_RECREATIONS = 3;

/**
 * Guest-variant of `useYjsProvider`. Takes a share link + guest identity
 * instead of depending on the workspace auth session.
 *
 * Intentionally simpler than the member hook — no IndexedDB persistence
 * (guests have no long-term cache), no offline cold-start fallback, fewer
 * reconnection heuristics. If the provider fails to authenticate, we back
 * off a few times and surface an error.
 */
export function useGuestYjsProvider(opts: {
  shareId: string;
  guestSub: string;
  guestName: string;
  resourceType: ShareResourceType;
  resourceId: string;
  enabled?: boolean;
}) {
  const { shareId, guestSub, guestName, resourceType, resourceId, enabled = true } = opts;
  const yjsType = yjsResourceTypeForShare(resourceType);
  const getGuestToken = useAction(api.shares.getGuestCollaborationToken);
  const getGuestTokenRef = useRef(getGuestToken);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled && yjsType !== null);
  const [isOffline, setIsOffline] = useState(false);
  const [provider, setProvider] = useState<YProvider | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const providerRef = useRef<YProvider | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recreationCountRef = useRef(0);

  const yDoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    getGuestTokenRef.current = getGuestToken;
  });

  useEffect(() => {
    if (!enabled || !yjsType) return;

    let cancelled = false;

    const connect = async () => {
      if (!navigator.onLine) {
        setIsOffline(true);
        setIsLoading(false);
        return;
      }

      let initialToken: string;
      let roomId: string;
      try {
        const result = await getGuestTokenRef.current({
          shareId,
          guestSub,
          guestName,
        });
        initialToken = result.token;
        roomId = result.roomId;
      } catch (err) {
        console.error("Failed to get guest collaboration token:", err);
        if (cancelled) return;
        setIsOffline(true);
        setIsLoading(false);
        if (recreationCountRef.current < MAX_RECREATIONS) {
          const delay = BASE_RECREATION_DELAY * 2 ** recreationCountRef.current;
          recreationCountRef.current += 1;
          setTimeout(() => {
            if (!cancelled) setReconnectTrigger((p) => p + 1);
          }, delay);
        }
        return;
      }

      if (cancelled) return;

      const host = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";
      let recreationTriggered = false;

      const newProvider = new YProvider(host, roomId, yDoc, {
        connect: true,
        params: { token: initialToken },
      });

      if (cancelled) {
        newProvider.destroy();
        return;
      }

      providerRef.current = newProvider;
      setProvider(newProvider);

      timeoutRef.current = setTimeout(() => {
        if (!cancelled && !isConnected) {
          setIsOffline(true);
          setIsLoading(false);
        }
      }, CONNECTION_TIMEOUT);

      const triggerRecreation = (p: YProvider) => {
        if (recreationTriggered) return;
        recreationTriggered = true;
        p.shouldConnect = false;
        try {
          p.awareness.setLocalState(null);
        } catch {
          // already destroyed
        }
        p.destroy();
        providerRef.current = null;
        setProvider(null);

        if (recreationCountRef.current >= MAX_RECREATIONS) {
          setIsOffline(true);
          setIsLoading(false);
          return;
        }
        const delay = BASE_RECREATION_DELAY * 2 ** recreationCountRef.current;
        recreationCountRef.current += 1;
        setTimeout(() => {
          if (!cancelled) setReconnectTrigger((p2) => p2 + 1);
        }, delay);
      };

      const handleProtocolMessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "permission_revoked") {
            recreationTriggered = true;
            setIsConnected(false);
            newProvider.shouldConnect = false;
            try {
              newProvider.awareness.setLocalState(null);
            } catch {
              // already destroyed
            }
            newProvider.destroy();
            providerRef.current = null;
            setProvider(null);
          } else if (msg.type === "auth_error") {
            if (!recreationTriggered) triggerRecreation(newProvider);
          }
        } catch {
          // not json
        }
      };

      guardAuthFailure(newProvider, () => {
        if (!recreationTriggered) triggerRecreation(newProvider);
      });

      newProvider.on("sync", (synced: boolean) => {
        if (cancelled) return;
        setIsConnected(synced);
        if (synced) {
          recreationCountRef.current = 0;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          setIsOffline(false);
          setIsLoading(false);
        }
      });

      newProvider.on("status", ({ status }: { status: string }) => {
        if (cancelled) return;
        if (status === "connected") {
          setIsConnected(true);
          setIsOffline(false);
          if (newProvider.ws) {
            newProvider.ws.addEventListener("message", handleProtocolMessage);
          }
        } else if (status === "disconnected") {
          setIsConnected(false);
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
      if (providerRef.current) {
        providerRef.current.shouldConnect = false;
        try {
          providerRef.current.awareness.setLocalState(null);
        } catch {
          // already destroyed
        }
        providerRef.current.destroy();
        providerRef.current = null;
      }
      setProvider(null);
    };
  }, [
    shareId,
    guestSub,
    guestName,
    resourceId,
    yjsType,
    enabled,
    yDoc,
    reconnectTrigger,
    isConnected,
  ]);

  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  return { yDoc, provider, isConnected, isLoading, isOffline };
}
