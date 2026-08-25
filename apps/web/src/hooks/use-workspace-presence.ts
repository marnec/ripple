import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import PartySocket from "partysocket";
import { api } from "@convex/_generated/api";
import type { QueryParams } from "@convex/types/routes";
import type {
  PresenceSnapshotMessage,
  PresenceChangedMessage,
  UserLeftPresenceMessage,
} from "@ripple/shared/protocol";
import {
  fetchCollaborationToken,
  invalidateCollaborationToken,
} from "@/lib/collaboration-token-cache";
import { useActiveCall } from "@/contexts/ActiveCallContext";

export interface PresenceEntry {
  userId: string;
  userName: string;
  userImage: string | null;
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
  /**
   * Channel whose call this user is joined to, if any. Reported separately
   * from the route because the floating call window lets a participant
   * navigate away while staying in the call.
   */
  callChannelId?: string;
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
  const getToken = useAction(api.collaboration.getCollaborationToken);

  // Presence is where "who is in this call right now" lives, rather than the
  // `callSessions` row: that row is only cleared by a clean last-participant
  // leave, so a closed tab strands it as `active` forever. A presence entry is
  // connection-scoped and self-heals on disconnect.
  const { status: callStatus, descriptor: callDescriptor } = useActiveCall();
  const callChannelId =
    callStatus === "joined" && callDescriptor?.kind === "channel"
      ? callDescriptor.resourceId
      : undefined;

  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceEntry>>(
    new Map(),
  );
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<PartySocket | null>(null);
  const recreationCountRef = useRef(0);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  // Clear presence data on workspace or auth changes (NOT on reconnects,
  // so follow-mode survives brief WebSocket reconnections)
  const resetKey = `${workspaceId}_${isAuthenticated}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPresenceMap(new Map());
    setIsConnected(false);
  }

  // Track current location for sending updates
  const pathnameRef = useRef(pathname);
  const paramsRef = useRef(params);
  const getTokenRef = useRef(getToken);
  const callChannelIdRef = useRef(callChannelId);
  useEffect(() => {
    pathnameRef.current = pathname;
    paramsRef.current = params;
    getTokenRef.current = getToken;
    callChannelIdRef.current = callChannelId;
  });

  // Connect to presence party
  useEffect(() => {
    if (!workspaceId || !isAuthenticated) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const roomKey = `presence-${workspaceId}`;

    const connect = async () => {
      if (!navigator.onLine) {
        setIsConnected(false);
        return;
      }

      try {
        // Reconnects (deploys, sleep/wake, brief drops) reuse a token that is
        // still valid rather than re-running the access-check action.
        const { token } = await fetchCollaborationToken(roomKey, () =>
          getTokenRef.current({
            resourceType: "presence",
            resourceId: workspaceId,
          }),
        );

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
              callChannelId: callChannelIdRef.current,
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
                  callChannelId: changed.callChannelId,
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
            } else if (msg.type === "permission_revoked") {
              // Removed from the workspace while connected. Spending the retry
              // budget is pointless (the token action would reject us anyway),
              // so burn it and drop the colleagues' locations we are holding —
              // otherwise the last snapshot stays on screen indefinitely.
              invalidateCollaborationToken(roomKey);
              recreationCountRef.current = MAX_RECREATIONS;
              setPresenceMap(new Map());
              socket.close();
            } else if (msg.type === "auth_error") {
              // Rejected — the backoff retry needs a freshly checked token.
              invalidateCollaborationToken(roomKey);
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
              2 ** recreationCountRef.current;
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
      // Don't clear presenceMap here — preserving stale data during reconnects
      // lets follow-mode survive brief WebSocket interruptions. The map is
      // cleared by a separate effect when workspaceId or auth changes, and
      // atomically replaced when the next presence_snapshot arrives.
      setIsConnected(false);
    };
  }, [workspaceId, isAuthenticated, reconnectTrigger]);

  // Send presence_update on route changes (while connected)
  const sendPresenceUpdate = () => {
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
        callChannelId: callChannelIdRef.current,
      }),
    );
  };

  useEffect(() => {
    sendPresenceUpdate();
  }, [
    pathname,
    params.workspaceId,
    params.channelId,
    params.documentId,
    params.diagramId,
    params.projectId,
    params.taskId,
    // Joining and leaving are not always route changes — the floating window
    // keeps a call alive across navigation, and Leave from it changes no path
    // at all. Without this dep the indicator would stick until the participant
    // happened to navigate.
    callChannelId,
  ]);

  // Browser offline/online detection
  useEffect(() => {
    const handleOffline = () => {
      setIsConnected(false);
    };
    const handleOnline = () => {
      recreationCountRef.current = 0;
      // Deliberately no `socketRef.current.close()` here. Since partysocket
      // 1.2.0, `close()` dispatches its `close` event synchronously, so
      // closing from this handler would run the "close" listener below while
      // `cancelled` is still false — scheduling a second, delayed reconnect on
      // top of the one this trigger causes. The connect effect's cleanup sets
      // `cancelled = true` *before* closing, so letting it own the teardown
      // keeps exactly one reconnect per online event.
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
