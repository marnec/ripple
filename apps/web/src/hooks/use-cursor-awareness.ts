import type { Awareness } from "y-protocols/awareness";
import { useEffect, useRef, useState } from "react";
import type { AwarenessUser } from "@/lib/awareness-types";
import type { ActivitySignal } from "@/lib/awareness-activity";

export interface RemoteUser {
  clientId: number;
  name: string;
  color: string;
  // cursor may be null if user is present but not actively editing
  cursor: { anchor: number; head: number } | null;
  /** Self-reported by that client: tab hidden, or no input for a while. */
  isIdle: boolean;
}

interface AwarenessState {
  user?: AwarenessUser;
  cursor?: {
    anchor: number;
    head: number;
  };
  activity?: ActivitySignal;
}

/**
 * Observe Yjs Awareness and return the collaborators present on this resource.
 *
 * Presence is membership of the awareness map, nothing more: while a tab holds
 * the document open its user belongs here, whether or not they are typing.
 * Departures are handled where they can be known accurately — the server
 * retires the cursors of connections that go away (`AwarenessOwnership`), and
 * `startAwarenessHeartbeat` sweeps peers that stop reporting entirely. Filtering
 * on "have I heard from them lately" here would only re-hide people who are
 * simply reading.
 *
 * Idleness is likewise not inferred: each client publishes its own `activity`
 * (see `awareness-activity.ts`), which arrives as an ordinary awareness change.
 */
export function useCursorAwareness(awareness: Awareness | null) {
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  /** Fingerprint of the previous setRemoteUsers call, to skip no-op updates. */
  const lastFingerprintRef = useRef("");

  useEffect(() => {
    if (!awareness) return;

    const sync = () => {
      const localClientId = awareness.clientID;
      const users: RemoteUser[] = [];

      awareness.getStates().forEach((state: AwarenessState, clientId: number) => {
        if (clientId === localClientId) return;
        const user = state.user;
        if (!user) return;

        users.push({
          clientId,
          name: user.name,
          color: user.color,
          cursor: state.cursor ?? null,
          isIdle: state.activity?.idle === true,
        });
      });

      const fingerprint = users
        .map((u) => `${u.clientId}:${u.name}:${u.isIdle}:${u.cursor?.anchor},${u.cursor?.head}`)
        .join("|");

      if (fingerprint !== lastFingerprintRef.current) {
        lastFingerprintRef.current = fingerprint;
        setRemoteUsers(users);
      }
    };

    awareness.on("change", sync);
    sync();

    return () => {
      awareness.off("change", sync);
      lastFingerprintRef.current = "";
      setRemoteUsers([]);
    };
  }, [awareness]);

  return { remoteUsers };
}
