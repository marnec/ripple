import { useAction, useConvexAuth } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import PartySocket from "partysocket";

const getCollaborationTokenRef = makeFunctionReference<
  "action",
  { resourceType: "doc" | "diagram" | "task" | "presence" | "spreadsheet"; resourceId: string },
  { token: string; roomId: string }
>("collaboration:getCollaborationToken");
import type { QueryParams } from "@shared/types/routes";
import type {
  PresenceSnapshotMessage,
  PresenceChangedMessage,
  UserLeftPresenceMessage,
} from "@shared/protocol";

export interface PresenceEntry {
  userId: string;
  userName: string;
  userImage: string | null;
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
}

const CONNECTION_TIMEOUT = 4000;
const MAX_RECREATIONS = 3;
const BASE_RECREATION_DELAY = 2000;

function parseResourceFromParams(params: Partial<QueryParams>) {
  if (params.taskId)
    return { resourceType: "task", resourceId: params.taskId };
  if (params.diagramId)
    return { resourceType: "diagram", resourceId: params.diagramId };
  if (params.documentId)
    return { resourceType: "document", resourceId: params.documentId };
  if (params.projectId)
    return { resourceType: "project", resourceId: params.projectId };
  if (params.channelId)
    return { resourceType: "channel", resourceId: params.channelId };
  return { resourceType: undefined, resourceId: undefined };
}

export function useWorkspacePresence() {
  const { pathname } = useLocation();
  const params = useParams<QueryParams>();
  const workspaceId = params.workspaceId;
  const { isAuthenticated } = useConvexAuth();
  const getToken = useAction(getCollaborationTokenRef);

  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceEntry>>(
    new Map(),
  );
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<PartySocket | null>(null);
  const recreationCountRef = useRef(0);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  // Track current location for sending updates
  const pathnameRef = useRef(pathname);
  const paramsRef = useRef(params);
  pathnameRef.current = pathname;
  paramsRef.current = params;

  // Stable ref for getToken to avoid effect re-runs
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Connect to presence party
  useEffect(() => {
    if (!workspaceId || !isAuthenticated) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (!navigator.onLine) {
        setIsConnected(false);
        return;
      }

      try {
        const { token } = await getTokenRef.current({
          resourceType: "presence",
          resourceId: workspaceId,
        });

        if (cancelled) return;

        const host =
          import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

        const socket = new PartySocket({
          host,
          room: workspaceId,
          party: "presence",
          query: { token },
          // Disable built-in reconnect — we handle it manually with token refresh
          maxRetries: 0,
        });

        if (cancelled) {
          socket.close();
          return;
        }

        socketRef.current = socket;

        // Connection timeout
        timeoutId = setTimeout(() => {
          if (!cancelled && socket.readyState !== WebSocket.OPEN) {
            setIsConnected(false);
          }
        }, CONNECTION_TIMEOUT);

        socket.addEventListener("open", () => {
          if (cancelled) return;
          clearTimeout(timeoutId);
          setIsConnected(true);
          recreationCountRef.current = 0;

          // Send initial presence_update
          const { resourceType, resourceId } = parseResourceFromParams(
            paramsRef.current,
          );
          socket.send(
            JSON.stringify({
              type: "presence_update",
              currentPath: pathnameRef.current,
              resourceType,
              resourceId,
            }),
          );
        });

        socket.addEventListener("message", (event) => {
          if (cancelled) return;
          if (typeof event.data !== "string") return;

          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "presence_snapshot") {
              const snapshot = msg as PresenceSnapshotMessage;
              const newMap = new Map<string, PresenceEntry>();
              for (const user of snapshot.users) {
                newMap.set(user.userId, user);
              }
              setPresenceMap(newMap);
            } else if (msg.type === "presence_changed") {
              const changed = msg as PresenceChangedMessage;
              setPresenceMap((prev) => {
                const next = new Map(prev);
                next.set(changed.userId, {
                  userId: changed.userId,
                  userName: changed.userName,
                  userImage: changed.userImage,
                  currentPath: changed.currentPath,
                  resourceType: changed.resourceType,
                  resourceId: changed.resourceId,
                });
                return next;
              });
            } else if (msg.type === "user_left_presence") {
              const left = msg as UserLeftPresenceMessage;
              setPresenceMap((prev) => {
                const next = new Map(prev);
                next.delete(left.userId);
                return next;
              });
            } else if (msg.type === "auth_error") {
              socket.close();
            }
          } catch {
            // Not valid JSON — ignore
          }
        });

        socket.addEventListener("close", () => {
          if (cancelled) return;
          setIsConnected(false);

          // Auto-reconnect with backoff (fetches fresh token)
          if (recreationCountRef.current < MAX_RECREATIONS) {
            const delay =
              BASE_RECREATION_DELAY *
              Math.pow(2, recreationCountRef.current);
            recreationCountRef.current += 1;
            setTimeout(() => {
              if (!cancelled) {
                setReconnectTrigger((prev) => prev + 1);
              }
            }, delay);
          }
        });
      } catch (err) {
        console.error("Failed to connect to presence server:", err);
        if (!cancelled) setIsConnected(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setPresenceMap(new Map());
      setIsConnected(false);
    };
  }, [workspaceId, isAuthenticated, reconnectTrigger]);

  // Send presence_update on route changes (while connected)
  const sendPresenceUpdate = useCallback(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)
      return;

    const { resourceType, resourceId } = parseResourceFromParams(
      paramsRef.current,
    );
    socketRef.current.send(
      JSON.stringify({
        type: "presence_update",
        currentPath: pathnameRef.current,
        resourceType,
        resourceId,
      }),
    );
  }, []);

  useEffect(() => {
    sendPresenceUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pathname,
    params.workspaceId,
    params.channelId,
    params.documentId,
    params.diagramId,
    params.projectId,
    params.taskId,
  ]);

  // Browser offline/online detection
  useEffect(() => {
    const handleOffline = () => {
      setIsConnected(false);
    };
    const handleOnline = () => {
      recreationCountRef.current = 0;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setReconnectTrigger((prev) => prev + 1);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { presenceMap, isConnected };
}
