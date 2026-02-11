import type { Awareness } from "y-protocols/awareness";
import { useEffect, useState } from "react";

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
  const [clientTimestamps, setClientTimestamps] = useState<Map<number, number>>(new Map());
  const [cursorPositions, setCursorPositions] = useState<Map<number, { position: CursorPosition; timestamp: number }>>(new Map());

  useEffect(() => {
    if (!awareness) {
      return;
    }

    const localClientId = awareness.clientID;

    const updateRemoteUsers = () => {
      const states = awareness.getStates();
      const now = Date.now();
      const users: RemoteUser[] = [];

      states.forEach((state: AwarenessState, clientId: number) => {
        // Skip local client
        if (clientId === localClientId) return;

        // Get last update timestamp for this client
        const lastUpdate = clientTimestamps.get(clientId) ?? now;

        // Filter out stale clients (>10s since last update)
        if (now - lastUpdate > 10000) return;

        const user = state.user;
        const cursor = state.cursor ?? null;

        if (user) {
          // Track cursor position changes for idle detection
          let isIdle = false;
          if (cursor) {
            const cursorData = cursorPositions.get(clientId);
            if (cursorData) {
              // Check if cursor position has changed
              const positionChanged =
                cursorData.position.anchor !== cursor.anchor ||
                cursorData.position.head !== cursor.head;

              if (!positionChanged) {
                // Cursor hasn't moved - check if it's been 30s
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

      setRemoteUsers(users);
    };

    const handleAwarenessChange = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const now = Date.now();
      const newTimestamps = new Map(clientTimestamps);
      const newCursorPositions = new Map(cursorPositions);

      // Update timestamps for changed clients
      [...added, ...updated].forEach((clientId) => {
        newTimestamps.set(clientId, now);

        // Track cursor position changes
        const state = awareness.getStates().get(clientId) as AwarenessState | undefined;
        if (state?.cursor) {
          const existingCursor = newCursorPositions.get(clientId);
          const positionChanged = !existingCursor ||
            existingCursor.position.anchor !== state.cursor.anchor ||
            existingCursor.position.head !== state.cursor.head;

          if (positionChanged) {
            newCursorPositions.set(clientId, {
              position: { anchor: state.cursor.anchor, head: state.cursor.head },
              timestamp: now,
            });
          }
        }
      });

      // Remove timestamps for removed clients
      removed.forEach((clientId) => {
        newTimestamps.delete(clientId);
        newCursorPositions.delete(clientId);
      });

      setClientTimestamps(newTimestamps);
      setCursorPositions(newCursorPositions);
      updateRemoteUsers();
    };

    // Initial update
    updateRemoteUsers();

    // Listen to awareness changes
    awareness.on("change", handleAwarenessChange);

    // Set up interval to re-evaluate staleness and idle state
    const interval = setInterval(updateRemoteUsers, 1000);

    return () => {
      awareness.off("change", handleAwarenessChange);
      clearInterval(interval);
      // Reset state when awareness is cleared
      setRemoteUsers([]);
      setClientTimestamps(new Map());
      setCursorPositions(new Map());
    };
  }, [awareness, clientTimestamps, cursorPositions]);

  return { remoteUsers };
}
