import { removeAwarenessStates, type Awareness } from "y-protocols/awareness";

/**
 * Keeps remote cursors honest.
 *
 * y-partyserver's provider calls `clearInterval(awareness._checkInterval)` when
 * it attaches, which disables both halves of y-protocols' liveness contract:
 * clients no longer re-announce themselves periodically, and nobody expires a
 * peer that stopped announcing. The visible result is a cursor that outlives
 * the tab that made it — nothing on the client ever retires it.
 *
 * This restores both halves at cadences we control:
 *
 *  - **Refresh**: re-publish local awareness every `REFRESH_INTERVAL_MS`, so
 *    "present but idle" stays distinguishable from "gone".
 *  - **Sweep**: drop peers that haven't been heard from in `STALE_AFTER_MS`.
 *    The provider broadcasts any awareness change regardless of origin, so a
 *    sweep here also heals the server and every other peer.
 *
 * The sweep is deliberately slow. The fast path for a departure is the server,
 * which retires a connection's cursors the moment it goes away; this only
 * catches what that missed. Meanwhile a hidden tab is still a present user, and
 * browsers throttle hidden tabs' timers to roughly one tick a minute — so the
 * threshold has to clear that by a wide margin or we would evict exactly the
 * background readers the facepile is meant to show.
 */

const TICK_MS = 4_000;
const REFRESH_INTERVAL_MS = 8_000;
const STALE_AFTER_MS = 120_000;

interface AwarenessMeta {
  lastUpdated: number;
}

/**
 * Which of the currently-present clients have gone quiet long enough to be
 * treated as gone. A present state with no metadata can't be aged, so it is
 * reported as stale — that shape only occurs for a state left behind.
 */
export function findStaleAwarenessClients(
  meta: Map<number, AwarenessMeta>,
  presentClientIds: Iterable<number>,
  localClientId: number,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): number[] {
  const stale: number[] = [];
  for (const clientId of presentClientIds) {
    if (clientId === localClientId) continue;
    const lastUpdated = meta.get(clientId)?.lastUpdated;
    if (lastUpdated === undefined || now - lastUpdated > staleAfterMs) {
      stale.push(clientId);
    }
  }
  return stale;
}

/**
 * Start the refresh + sweep loop for an awareness instance.
 * Returns a stop function; safe to call for a provider that is offline.
 */
export function startAwarenessHeartbeat(awareness: Awareness): () => void {
  const tick = () => {
    const now = Date.now();

    // Re-publish local state so peers can tell idle from departed.
    const localState = awareness.getLocalState();
    const localMeta = awareness.meta.get(awareness.clientID);
    if (
      localState !== null &&
      (localMeta === undefined || now - localMeta.lastUpdated >= REFRESH_INTERVAL_MS)
    ) {
      awareness.setLocalState(localState);
    }

    const stale = findStaleAwarenessClients(
      awareness.meta,
      awareness.getStates().keys(),
      awareness.clientID,
      now,
    );
    if (stale.length > 0) {
      removeAwarenessStates(awareness, stale, "stale-sweep");
    }
  };

  const interval = setInterval(tick, TICK_MS);
  return () => clearInterval(interval);
}
