/**
 * Pure state machine for the call lifecycle. No React, no Convex, no RTK.
 *
 * The phases mirror what the side-effecting `useCallSession` hook drives:
 *
 *   idle ──ENTER_LOBBY──> lobby ──JOIN_REQUESTED──> joining
 *                                                   │
 *                          ┌────────TOKEN_OK────────┘  (token+meetingId stored)
 *                          ▼
 *                       joining ──RTK_JOINED──> joined
 *                          │                       │
 *                          │                       │
 *                          ▼                       ▼
 *                        error                  leaving ──RTK_LEFT──> idle
 *
 * TERMINATED jumps from `joined`/`joining`/`leaving` to `error` (kick,
 * disconnect, etc.). RESET returns to idle from any state.
 *
 * Events that don't make sense for the current status are silently
 * dropped — the reducer never throws. This matches the "ignore stale
 * events" pattern needed when async side effects race with user actions
 * (e.g. a `TOKEN_OK` arriving after the user already clicked Leave).
 */

export type CallStatus =
  | "idle"
  | "lobby"
  | "joining"
  | "joined"
  | "leaving"
  | "error";

export type CallErrorReason =
  | "token-failed"
  | "rtk-init-failed"
  | "rtk-join-failed"
  | "kicked"
  | "network-lost"
  | "unknown";

export interface CallError {
  message: string;
  reason: CallErrorReason;
}

export interface CallState {
  status: CallStatus;
  authToken: string | null;
  meetingId: string | null;
  /** Whether the joined call is being transcribed. Set on TOKEN_OK. */
  transcribe: boolean;
  error: CallError | null;
}

export type CallEvent =
  | { type: "ENTER_LOBBY" }
  | { type: "JOIN_REQUESTED" }
  | {
      type: "TOKEN_OK";
      authToken: string;
      meetingId: string;
      transcribe?: boolean;
    }
  | { type: "RTK_JOINED" }
  | { type: "JOIN_FAILED"; reason: CallErrorReason; message: string }
  | { type: "LEAVE_REQUESTED" }
  | { type: "RTK_LEFT" }
  | { type: "TERMINATED"; reason: CallErrorReason; message: string }
  | { type: "RESET" };

export const initialCallState: CallState = {
  status: "idle",
  authToken: null,
  meetingId: null,
  transcribe: false,
  error: null,
};

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case "ENTER_LOBBY":
      // Allowed from idle, error (after acknowledging), or already-lobby
      // (idempotent re-entry). From joined/joining/leaving we ignore — the
      // session is already in flight; the caller must leave first.
      if (
        state.status === "idle" ||
        state.status === "error" ||
        state.status === "lobby"
      ) {
        return {
          status: "lobby",
          authToken: null,
          meetingId: null,
          transcribe: false,
          error: null,
        };
      }
      return state;

    case "JOIN_REQUESTED":
      if (state.status !== "lobby") return state;
      return { ...state, status: "joining", error: null };

    case "TOKEN_OK":
      // Stash the credentials mid-flight. Status remains `joining` until
      // RTK reports a successful join.
      if (state.status !== "joining") return state;
      return {
        ...state,
        authToken: event.authToken,
        meetingId: event.meetingId,
        transcribe: event.transcribe ?? false,
      };

    case "RTK_JOINED":
      if (state.status !== "joining") return state;
      return { ...state, status: "joined" };

    case "JOIN_FAILED":
      // A token or RTK failure during the joining phase. The hook will
      // have already torn down any partial RTK client — the reducer just
      // records the error and clears credentials.
      if (state.status !== "joining" && state.status !== "lobby") return state;
      return {
        status: "error",
        authToken: null,
        meetingId: null,
        transcribe: false,
        error: { reason: event.reason, message: event.message },
      };

    case "LEAVE_REQUESTED":
      // Leaving is only meaningful from `joined`. From other states a
      // leave click should already be impossible (no leave button shown);
      // we no-op rather than crash.
      if (state.status !== "joined") return state;
      return { ...state, status: "leaving" };

    case "RTK_LEFT":
      // Accept from `leaving` (the happy path) and from `error` (cleanup
      // after a mid-call failure where the RTK client still emitted left
      // before being torn down). Anything else is a stale event.
      if (state.status !== "leaving" && state.status !== "error") return state;
      return { ...initialCallState };

    case "TERMINATED":
      // External termination (kick, network lost, server-side hangup).
      // Valid from any active phase. From idle/lobby it's stale — ignore.
      if (
        state.status === "idle" ||
        state.status === "lobby" ||
        state.status === "error"
      ) {
        return state;
      }
      return {
        status: "error",
        authToken: state.authToken,
        meetingId: state.meetingId,
        transcribe: state.transcribe,
        error: { reason: event.reason, message: event.message },
      };

    case "RESET":
      // Universal escape hatch — primarily used after acknowledging an
      // error to return to idle.
      return { ...initialCallState };
  }
}
