import type { Awareness } from "y-protocols/awareness";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";

export interface RemotePointer {
  clientId: number;
  name: string;
  color: string;
  // Canvas coordinates (NOT screen coords) - null if user is present but not actively editing
  pointer: { x: number; y: number } | null;
  // Element IDs locked by this user (lock-on-select)
  lockedElements: string[];
  lastUpdate: number; // timestamp of last awareness change for this client
  isIdle: boolean; // true if pointer hasn't moved in 30s
}

interface AwarenessState {
  user?: {
    name: string;
    color: string;
  };
  pointer?: {
    x: number;
    y: number;
  };
  lockedElements?: {
    elementIds: string[];
  };
}

interface PointerPosition {
  x: number;
  y: number;
}

// Match Phase 12 timeouts for consistency
const STALE_TIMEOUT = 10000; // 10 seconds - remove stale clients
const IDLE_TIMEOUT = 30000; // 30 seconds - fade idle cursors

/**
 * Hook to observe Yjs Awareness state and return remote pointers with positions.
 *
 * Features:
 * - Filters out stale clients (>10s since last update) to handle unclean disconnects
 * - Tracks idle state (>30s since pointer position changed) for fade effect
 * - Tracks locked element IDs for conflict prevention
 * - Listens to awareness change events for real-time updates
 */
export function useDiagramCursorAwareness(awareness: Awareness | null) {
  const [remotePointers, setRemotePointers] = useState<RemotePointer[]>([]);
  const clientTimestampsRef = useRef<Map<number, number>>(new Map());
  const pointerPositionsRef = useRef<Map<number, { position: PointerPosition; timestamp: number }>>(new Map());
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";

  const updateRemotePointers = useCallback(() => {
    if (!awareness) return;

    const states = awareness.getStates();
    const now = Date.now();
    const localClientId = awareness.clientID;
    const pointers: RemotePointer[] = [];

    states.forEach((state: AwarenessState, clientId: number) => {
      if (clientId === localClientId) return;

      const lastUpdate = clientTimestampsRef.current.get(clientId) ?? now;

      // Filter out stale clients (>10s since last update)
      if (now - lastUpdate > STALE_TIMEOUT) return;

      const user = state.user;
      const pointer = state.pointer ?? null;
      const lockedElements = state.lockedElements?.elementIds || [];

      if (user) {
        let isIdle = false;
        if (pointer) {
          const pointerData = pointerPositionsRef.current.get(clientId);
          if (pointerData) {
            const positionChanged =
              pointerData.position.x !== pointer.x ||
              pointerData.position.y !== pointer.y;

            if (!positionChanged) {
              isIdle = now - pointerData.timestamp > IDLE_TIMEOUT;
            }
          }
        }

        pointers.push({
          clientId,
          name: user.name,
          color: getExcalidrawCollaboratorColor(clientId, isDarkTheme),
          pointer,
          lockedElements,
          lastUpdate,
          isIdle,
        });
      }
    });

    setRemotePointers(pointers);
  }, [awareness, isDarkTheme]);

  useEffect(() => {
    if (!awareness) return;

    const handleAwarenessChange = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const now = Date.now();

      // Update timestamps for changed clients
      [...added, ...updated].forEach((clientId) => {
        clientTimestampsRef.current.set(clientId, now);

        // Track pointer position changes
        const state = awareness.getStates().get(clientId) as AwarenessState | undefined;
        if (state?.pointer) {
          const existingPointer = pointerPositionsRef.current.get(clientId);
          const positionChanged = !existingPointer ||
            existingPointer.position.x !== state.pointer.x ||
            existingPointer.position.y !== state.pointer.y;

          if (positionChanged) {
            pointerPositionsRef.current.set(clientId, {
              position: { x: state.pointer.x, y: state.pointer.y },
              timestamp: now,
            });
          }
        }
      });

      // Remove data for removed clients
      removed.forEach((clientId) => {
        clientTimestampsRef.current.delete(clientId);
        pointerPositionsRef.current.delete(clientId);
      });

      updateRemotePointers();
    };

    awareness.on("change", handleAwarenessChange);

    // Re-evaluate staleness and idle state every second
    const interval = setInterval(updateRemotePointers, 1000);

    return () => {
      awareness.off("change", handleAwarenessChange);
      clearInterval(interval);
      setRemotePointers([]);
    };
  }, [awareness, updateRemotePointers]);

  return { remotePointers };
}
