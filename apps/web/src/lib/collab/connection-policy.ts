/**
 * The reconnection policy for a collaborative Yjs room, as a pure reducer.
 *
 * The provider lifecycle used to live inside two ~150-line effect closures
 * (member + guest), which is why the guest copy silently lacked the member
 * copy's storm detection. Deciding *what* to do lives here, in a function with
 * no timers, no sockets and no React; the hook is left with the imperative
 * shell that carries the decisions out.
 */

/** A connection's observable condition. */
export type ConnectionPhase =
  /** Nothing attempted yet. */
  | "idle"
  /** Provider constructed, waiting for the first sync. */
  | "connecting"
  /** Synced with the room. */
  | "connected"
  /** Degraded, but recoverable — a browser `online` event resets and retries. */
  | "offline"
  /** Terminal. The server refused us and retrying cannot help. */
  | "stopped";

/** Base delay for the exponential backoff between provider recreations. */
const BASE_RECREATION_DELAY = 2_000;
/** Recreations attempted before we stop and wait for the network to change. */
const MAX_RECREATIONS = 3;
/** A connection that dies sooner than this never really worked. */
const SHORT_LIVED_THRESHOLD = 2_000;
/** How many short-lived connections in the window count as a storm. */
const MAX_RAPID_DISCONNECTS = 3;
/** The window over which short-lived connections are counted. */
const RAPID_DISCONNECT_WINDOW = 15_000;

export interface ConnectionState {
  phase: ConnectionPhase;
  /**
   * Whether this room has ever completed a sync. Distinct from `phase`, which
   * is where we are *now*: once the room has handed us its state, we hold that
   * state for the rest of the session even if the socket later dies. That is
   * what makes an empty document readable as "empty" rather than "unknown" —
   * see `isHydrated` in `useCollaborativeDoc`.
   */
  hasSynced: boolean;
  /** How many times we have already torn down and rebuilt the provider. */
  recreationCount: number;
  /** When the socket last opened, so we can measure how long it survived. */
  lastConnectedAt: number | null;
  /** Timestamps of recent short-lived connections, pruned to the window. */
  shortLivedConnections: number[];
}

export type ConnectionEvent =
  | { type: "synced"; at: number }
  /** Server refused the token: an `auth_error` frame, or a 1008 close. */
  | { type: "auth-rejected"; at: number }
  /** The WebSocket opened. Not proof of authorization — see storm detection. */
  | { type: "status-connected"; at: number }
  /** The WebSocket closed, for any reason. */
  | { type: "status-disconnected"; at: number }
  /** The server told us our access to this room is gone. Not retryable. */
  | { type: "permission-revoked"; at: number }
  /** The browser regained connectivity. */
  | { type: "browser-online"; at: number }
  /** The browser lost connectivity, or had none when we tried to connect. */
  | { type: "browser-offline"; at: number }
  /** Minting a collaboration token failed. */
  | { type: "token-failed"; at: number }
  /** The provider never synced within the connection timeout. */
  | { type: "connect-timed-out"; at: number }
  /** A different room is being opened. Everything learned so far is void. */
  | { type: "reset"; at: number };

export type ConnectionEffect =
  | { type: "clear-connect-timeout" }
  | { type: "teardown" }
  | { type: "invalidate-token" }
  | { type: "reconnect-after"; delayMs: number };

export interface ConnectionTransition {
  state: ConnectionState;
  effects: ConnectionEffect[];
}

export function initialConnectionState(): ConnectionState {
  return {
    phase: "idle",
    hasSynced: false,
    recreationCount: 0,
    lastConnectedAt: null,
    shortLivedConnections: [],
  };
}

/**
 * The three booleans every collaboration surface renders from.
 *
 * `isConnecting` is about the socket, not about the page: it means we are
 * still trying, and have neither succeeded nor given up. Whether there is
 * anything to *show* is a separate question, answered by `isHydrated` — a
 * cached document is readable while this is still true.
 */
export interface ConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  isOffline: boolean;
}

export function connectionStatus(state: ConnectionState): ConnectionStatus {
  return {
    isConnected: state.phase === "connected",
    isConnecting: state.phase === "idle" || state.phase === "connecting",
    isOffline: state.phase === "offline" || state.phase === "stopped",
  };
}

export function reduceConnection(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionTransition {
  // A reset outranks everything, including `stopped` — that is its whole job.
  if (event.type === "reset") {
    return { state: initialConnectionState(), effects: [] };
  }

  // `stopped` means the server refused us for a reason no retry can fix.
  // Nothing short of opening a different room should get us out of it.
  if (state.phase === "stopped") {
    return { state, effects: [] };
  }

  switch (event.type) {
    case "synced":
      return {
        // A sync proves the room is reachable with our credentials, so the
        // budget spent getting here is no longer relevant to the next failure.
        state: {
          ...state,
          phase: "connected",
          // Sticky for the life of this room: a later disconnect does not take
          // the state we were given back out of memory.
          hasSynced: true,
          recreationCount: 0,
          shortLivedConnections: [],
        },
        effects: [{ type: "clear-connect-timeout" }],
      };

    case "auth-rejected":
      return recreate(state, [{ type: "teardown" }, { type: "invalidate-token" }]);

    case "token-failed": {
      // No provider was built, so there is nothing to tear down — but the user
      // should see offline now rather than a spinner that hides the retry.
      const retry = recreate(state, []);
      return { state: { ...retry.state, phase: "offline" }, effects: retry.effects };
    }

    case "browser-offline":
      return { state: { ...state, phase: "offline" }, effects: [] };

    case "connect-timed-out":
      // Deliberately no retry: y-partyserver is still working its own socket,
      // and racing it with a second provider is what causes storms.
      return { state: { ...state, phase: "offline" }, effects: [] };

    case "permission-revoked":
      return {
        state: { ...state, phase: "stopped" },
        effects: [{ type: "teardown" }, { type: "invalidate-token" }],
      };

    case "browser-online":
      // A network change is the one thing that plausibly fixes a failure we
      // have already given up on, so it buys a fresh budget.
      return {
        state: {
          ...state,
          phase: "connecting",
          recreationCount: 0,
          shortLivedConnections: [],
          lastConnectedAt: null,
        },
        effects: [{ type: "teardown" }, { type: "reconnect-after", delayMs: 0 }],
      };

    case "status-connected":
      return {
        state: { ...state, phase: "connected", lastConnectedAt: event.at },
        effects: [],
      };

    case "status-disconnected": {
      const survived =
        state.lastConnectedAt === null ? Infinity : event.at - state.lastConnectedAt;

      if (survived >= SHORT_LIVED_THRESHOLD) {
        return { state: { ...state, phase: "connecting" }, effects: [] };
      }

      const shortLivedConnections = [
        ...state.shortLivedConnections.filter(
          (at) => at > event.at - RAPID_DISCONNECT_WINDOW,
        ),
        event.at,
      ];

      if (shortLivedConnections.length < MAX_RAPID_DISCONNECTS) {
        return {
          state: { ...state, phase: "connecting", shortLivedConnections },
          effects: [],
        };
      }

      // The socket keeps opening and dying — treat it as the rejection it
      // almost certainly is, and go through the same backoff.
      return recreate({ ...state, shortLivedConnections: [] }, [
        { type: "teardown" },
        { type: "invalidate-token" },
      ]);
    }
  }
}

/**
 * Tear the provider down and schedule a rebuild, unless the retry budget is
 * spent — in which case we settle into `offline` and wait for a network change
 * to reset us, rather than hammering a server that keeps saying no.
 */
function recreate(
  state: ConnectionState,
  teardownEffects: ConnectionEffect[],
): ConnectionTransition {
  if (state.recreationCount >= MAX_RECREATIONS) {
    return {
      state: { ...state, phase: "offline" },
      effects: teardownEffects,
    };
  }

  return {
    state: {
      ...state,
      phase: "connecting",
      recreationCount: state.recreationCount + 1,
    },
    effects: [
      ...teardownEffects,
      {
        type: "reconnect-after",
        delayMs: BASE_RECREATION_DELAY * 2 ** state.recreationCount,
      },
    ],
  };
}
