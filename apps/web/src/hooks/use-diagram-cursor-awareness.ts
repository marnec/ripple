import type { Awareness } from "y-protocols/awareness";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";
import type { AwarenessUser } from "@/lib/awareness-types";
import type { ActivitySignal } from "@/lib/awareness-activity";

export interface RemotePointer {
  clientId: number;
  name: string;
  color: string;
  // Canvas coordinates (NOT screen coords) - null if user is present but not actively editing
  pointer: { x: number; y: number } | null;
  // Element IDs locked by this user (lock-on-select)
  lockedElements: string[];
  /** Self-reported by that client: tab hidden, or no input for a while. */
  isIdle: boolean;
}

interface AwarenessState {
  user?: AwarenessUser;
  pointer?: {
    x: number;
    y: number;
  };
  lockedElements?: {
    elementIds: string[];
  };
  activity?: ActivitySignal;
}

/**
 * Observe Yjs Awareness and return the collaborators present on this diagram.
 *
 * Same model as `useCursorAwareness`: presence is membership of the awareness
 * map (a tab holding the diagram open belongs here even while its user is
 * still), departures are retired by the server and the client heartbeat, and
 * idleness is self-reported rather than inferred from pointer movement.
 */
export function useDiagramCursorAwareness(awareness: Awareness | null) {
  const [remotePointers, setRemotePointers] = useState<RemotePointer[]>([]);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";

  useEffect(() => {
    if (!awareness) return;

    const sync = () => {
      const localClientId = awareness.clientID;
      const pointers: RemotePointer[] = [];

      awareness.getStates().forEach((state: AwarenessState, clientId: number) => {
        if (clientId === localClientId) return;
        const user = state.user;
        if (!user) return;

        pointers.push({
          clientId,
          name: user.name,
          color: getExcalidrawCollaboratorColor(clientId, isDarkTheme),
          pointer: state.pointer ?? null,
          lockedElements: state.lockedElements?.elementIds ?? [],
          isIdle: state.activity?.idle === true,
        });
      });

      // Bail out when nothing displayed actually changed, so remote awareness
      // noise doesn't re-render the diagram page.
      setRemotePointers((prev) => {
        if (
          prev.length === pointers.length &&
          prev.every((p, i) => {
            const n = pointers[i];
            return (
              p.clientId === n.clientId &&
              p.pointer?.x === n.pointer?.x &&
              p.pointer?.y === n.pointer?.y &&
              p.isIdle === n.isIdle &&
              p.color === n.color &&
              p.lockedElements.length === n.lockedElements.length
            );
          })
        ) {
          return prev; // Same reference → React bails out
        }
        return pointers;
      });
    };

    const handleAwarenessChange = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      // If only the local client changed (e.g. local cursor move), skip entirely —
      // local state is filtered out in sync() anyway, and calling setRemotePointers
      // with a new array reference would re-render DiagramPageContent on every
      // single pointer move.
      const localClientId = awareness.clientID;
      const nonLocalChanged = [...added, ...updated, ...removed].filter(
        (id) => id !== localClientId,
      );
      if (nonLocalChanged.length === 0) return;

      sync();
    };

    awareness.on("change", handleAwarenessChange);
    sync();

    return () => {
      awareness.off("change", handleAwarenessChange);
      setRemotePointers([]);
    };
  }, [awareness, isDarkTheme]);

  return { remotePointers };
}
