import { useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import RTKClient from "@cloudflare/realtimekit";
import { useAction, useQuery } from "convex/react";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useIsMobile } from "./use-mobile";

export interface CursorPosition {
  userId: string;
  userName: string;
  x: number; // % of container width
  y: number; // % of container height
  lastUpdated: number;
}

const THROTTLE_MS = 200;
const STALE_TIMEOUT_MS = 5000;
const STALE_CHECK_INTERVAL_MS = 3000;
const RENDER_INTERVAL_MS = 50; // 20fps max

export function useCursorTracking(opts: {
  documentId: Id<"documents">;
  editorRef: RefObject<HTMLDivElement | null>;
  enabled?: boolean;
}): { cursors: Map<string, CursorPosition>; isConnected: boolean } {
  const { documentId, editorRef, enabled = true } = opts;
  const isMobile = useIsMobile();
  const user = useQuery(api.users.viewer);
  const joinCursorSession = useAction(api.cursorSessions.joinCursorSession);

  const [, setRenderTick] = useState(0);
  const cursorsRef = useRef<Map<string, CursorPosition>>(new Map());
  const meetingRef = useRef<RTKClient | null>(null);
  const isConnectedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const lastBroadcastRef = useRef(0);
  const pendingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupDoneRef = useRef(false);

  // Separate hook call — must be at top level, not conditional
  const [, initMeeting] = useRealtimeKitClient();

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      const meeting = meetingRef.current;
      if (!meeting || !user || !isConnectedRef.current) return;

      const now = Date.now();
      const timeSinceLast = now - lastBroadcastRef.current;

      const doSend = () => {
        lastBroadcastRef.current = Date.now();
        meeting.participants
          .broadcastMessage("cursor_move", {
            userId: user._id,
            userName: user.name || "Anonymous",
            x,
            y,
          })
          .catch(() => {
            // Silently ignore broadcast errors (rate limit, disconnection)
          });
      };

      if (timeSinceLast >= THROTTLE_MS) {
        if (pendingBroadcastRef.current) {
          clearTimeout(pendingBroadcastRef.current);
          pendingBroadcastRef.current = null;
        }
        doSend();
      } else if (!pendingBroadcastRef.current) {
        pendingBroadcastRef.current = setTimeout(
          doSend,
          THROTTLE_MS - timeSinceLast,
        );
      }
    },
    [user],
  );

  const broadcastLeave = useCallback(() => {
    const meeting = meetingRef.current;
    if (!meeting || !user || !isConnectedRef.current) return;
    meeting.participants
      .broadcastMessage("cursor_leave", { userId: user._id })
      .catch(() => {});
  }, [user]);

  // Connect to RTK meeting
  useEffect(() => {
    if (!enabled || isMobile || !user) return;

    let cancelled = false;
    cleanupDoneRef.current = false;
    const cursorsMap = cursorsRef.current;

    const connect = async () => {
      try {
        const { authToken } = await joinCursorSession({
          documentId,
          userName: user.name || "Anonymous",
        });

        if (cancelled) return;

        const m = await initMeeting({
          authToken,
          defaults: { audio: false, video: false },
        });

        if (cancelled || !m) return;

        await m.join();

        if (cancelled) {
          await m.leave();
          return;
        }

        meetingRef.current = m;
        isConnectedRef.current = true;
        setIsConnected(true);

        // Listen for broadcast messages
        m.participants.on(
          "broadcastedMessage",
          ({
            type,
            payload,
          }: {
            type: string;
            payload: Record<string, unknown>;
          }) => {
            const senderId = payload.userId as string;
            // Ignore own cursor
            if (senderId === user._id) return;

            if (type === "cursor_move") {
              cursorsRef.current.set(senderId, {
                userId: senderId,
                userName: payload.userName as string,
                x: payload.x as number,
                y: payload.y as number,
                lastUpdated: Date.now(),
              });
            } else if (type === "cursor_leave") {
              cursorsRef.current.delete(senderId);
            }
          },
        );

        // Clean up when participant leaves
        m.participants.joined.on("participantLeft", (participant) => {
          const customId = participant.customParticipantId;
          if (customId) {
            cursorsRef.current.delete(customId);
          }
        });
      } catch (err) {
        console.error("Cursor tracking connection failed:", err);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (pendingBroadcastRef.current) {
        clearTimeout(pendingBroadcastRef.current);
        pendingBroadcastRef.current = null;
      }
      const m = meetingRef.current;
      if (m && !cleanupDoneRef.current) {
        cleanupDoneRef.current = true;
        m.leave().catch(() => {});
      }
      meetingRef.current = null;
      isConnectedRef.current = false;
      setIsConnected(false);
      cursorsMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, enabled, isMobile, user?._id]);

  // Mouse tracking on editor
  useEffect(() => {
    if (!enabled || isMobile) return;
    const el = editorRef.current;
    if (!el) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      broadcastCursor(x, y);
    };

    const handleMouseLeave = () => {
      broadcastLeave();
    };

    el.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [enabled, isMobile, editorRef, broadcastCursor, broadcastLeave]);

  // Render batching — tick at max 20fps
  useEffect(() => {
    if (!enabled || isMobile) return;
    const interval = setInterval(() => {
      setRenderTick((t) => t + 1);
    }, RENDER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, isMobile]);

  // Stale cursor cleanup
  useEffect(() => {
    if (!enabled || isMobile) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [id, cursor] of cursorsRef.current) {
        if (now - cursor.lastUpdated > STALE_TIMEOUT_MS) {
          cursorsRef.current.delete(id);
        }
      }
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, isMobile]);

  // beforeunload cleanup
  useEffect(() => {
    if (!enabled || isMobile) return;
    const handler = () => {
      const m = meetingRef.current;
      if (m && !cleanupDoneRef.current) {
        cleanupDoneRef.current = true;
        m.leave().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, isMobile]);

  return { cursors: cursorsRef.current, isConnected };
}
