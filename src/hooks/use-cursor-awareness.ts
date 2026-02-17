import type { Awareness } from "y-protocols/awareness";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RemoteUser {
  clientId: number;
  name: string;
  color: string;
  // cursor may be null if user is present but not actively editing
  cursor: { anchor: number; head: number } | null;
  lastUpdate: number; // timestamp of last awareness change for this client
  isIdle: boolean; // true if cursor hasn't moved in 30s
}

interface AwarenessState {
  user?: {
    name: string;
    color: string;
  };
  cursor?: {
    anchor: number;
    head: number;
  };
}

interface CursorPosition {
  anchor: number;
  head: number;
}

/**
 * Hook to observe Yjs Awareness state and return remote users with cursor positions.
 *
 * Features:
 * - Filters out stale clients (>10s since last update) to handle unclean disconnects
 * - Tracks idle state (>30s since cursor position changed) for fade effect
 * - Listens to awareness change events for real-time updates
 */
export function useCursorAwareness(awareness: Awareness | null) {
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const clientTimestampsRef = useRef<Map<number, number>>(new Map());
  const cursorPositionsRef = useRef<Map<number, { position: CursorPosition; timestamp: number }>>(new Map());
  /** Fingerprint of previous setRemoteUsers call to skip no-op updates */
  const lastFingerprintRef = useRef("");

  const updateRemoteUsers = useCallback(() => {
    if (!awareness) return;

    const states = awareness.getStates();
    const now = Date.now();
    const localClientId = awareness.clientID;
    const users: RemoteUser[] = [];

    states.forEach((state: AwarenessState, clientId: number) => {
      if (clientId === localClientId) return;

      const lastUpdate = clientTimestampsRef.current.get(clientId) ?? now;

      // Filter out stale clients (>10s since last update)
      if (now - lastUpdate > 10000) return;

      const user = state.user;
      const cursor = state.cursor ?? null;

      if (user) {
        let isIdle = false;
        if (cursor) {
          const cursorData = cursorPositionsRef.current.get(clientId);
          if (cursorData) {
            const positionChanged =
              cursorData.position.anchor !== cursor.anchor ||
              cursorData.position.head !== cursor.head;

            if (!positionChanged) {
              isIdle = now - cursorData.timestamp > 30000;
            }
          }
        }

        users.push({
          clientId,
          name: user.name,
          color: user.color,
          cursor,
          lastUpdate,
          isIdle,
        });
      }
    });

    // Build a fingerprint to avoid triggering React re-renders when nothing changed.
    // Intentionally excludes lastUpdate (always changes) — only tracks identity + cursor + idle.
    const fingerprint = users
      .map(u => `${u.clientId}:${u.name}:${u.isIdle}:${u.cursor?.anchor},${u.cursor?.head}`)
      .join("|");

    if (fingerprint !== lastFingerprintRef.current) {
      lastFingerprintRef.current = fingerprint;
      setRemoteUsers(users);
    }
  }, [awareness]);

  useEffect(() => {
    if (!awareness) return;

    const handleAwarenessChange = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const now = Date.now();

      // Update timestamps for changed clients
      [...added, ...updated].forEach((clientId) => {
        clientTimestampsRef.current.set(clientId, now);

        // Track cursor position changes
        const state = awareness.getStates().get(clientId) as AwarenessState | undefined;
        if (state?.cursor) {
          const existingCursor = cursorPositionsRef.current.get(clientId);
          const positionChanged = !existingCursor ||
            existingCursor.position.anchor !== state.cursor.anchor ||
            existingCursor.position.head !== state.cursor.head;

          if (positionChanged) {
            cursorPositionsRef.current.set(clientId, {
              position: { anchor: state.cursor.anchor, head: state.cursor.head },
              timestamp: now,
            });
          }
        }
      });

      // Remove data for removed clients
      removed.forEach((clientId) => {
        clientTimestampsRef.current.delete(clientId);
        cursorPositionsRef.current.delete(clientId);
      });

      updateRemoteUsers();
    };

    awareness.on("change", handleAwarenessChange);

    // Re-evaluate staleness and idle state every second
    const interval = setInterval(updateRemoteUsers, 1000);

    return () => {
      awareness.off("change", handleAwarenessChange);
      clearInterval(interval);
      setRemoteUsers([]);
    };
  }, [awareness, updateRemoteUsers]);

  return { remoteUsers };
}
