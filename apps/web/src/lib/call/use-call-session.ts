import type RTKClient from "@cloudflare/realtimekit";
import { useEffect, useReducer, useRef, useState } from "react";

import {
  callReducer,
  initialCallState,
  type CallErrorReason,
  type CallState,
} from "./reducer";
import type {
  CallJoinPreferences,
  CallSourcePort,
} from "./source-port";

/**
 * Owns the imperative half of a call lifecycle: the RTK client, the
 * Convex token round-trip, and device application. The pure reducer
 * (`callReducer`) holds the phase state; this hook drives it.
 *
 * The hook is source-agnostic — it accepts a `CallSourcePort` at the
 * moment of `enterLobby` and remembers it for the duration of the
 * session. That late-binding is what lets one hook serve channel and
 * event calls from a single global mount: the active source rotates as
 * the user enters different calls, but the hook (and the joined RTK
 * client) survives navigation.
 */

export interface UseCallSessionResult {
  state: CallState;
  source: CallSourcePort | null;
  meeting: RTKClient | null;

  enterLobby: (source: CallSourcePort) => void;
  joinCall: (prefs: CallJoinPreferences) => Promise<void>;
  leaveCall: () => Promise<void>;
  /** Reset error state back to idle. Called from UI's "back" button on the error screen. */
  reset: () => void;
}

function classifyError(err: unknown): { reason: CallErrorReason; message: string } {
  const message = err instanceof Error ? err.message : "Failed to join call";
  return { reason: "unknown", message };
}

export function useCallSession(): UseCallSessionResult {
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const [source, setSource] = useState<CallSourcePort | null>(null);
  const [meeting, setMeeting] = useState<RTKClient | null>(null);

  // Stable refs for cleanup paths that fire after the active source has
  // already been swapped (e.g. tab close mid-call, or an in-flight leave
  // racing a new lobby entry).
  const meetingRef = useRef<RTKClient | null>(null);
  const sourceRef = useRef<CallSourcePort | null>(null);
  useEffect(() => {
    meetingRef.current = meeting;
    sourceRef.current = source;
  }, [meeting, source]);

  // Guards re-entrancy of the lazy `RTKClient.init` import. Without this,
  // a double-click on Join could fire two parallel inits and leak the
  // first client.
  const initRunning = useRef(false);

  const enterLobby = (next: CallSourcePort): void => {
    const active = sourceRef.current;
    const sameResource =
      active?.descriptor.resourceId === next.descriptor.resourceId;

    // From idle / error / lobby we accept any source. Lobby is pre-commit
    // (no token, no RTK client), so swapping the target is harmless.
    if (
      state.status === "idle" ||
      state.status === "error" ||
      state.status === "lobby"
    ) {
      setSource(next);
      dispatch({ type: "ENTER_LOBBY" });
      return;
    }

    // From any active phase (joining / joined / leaving), only accept a
    // re-entry of the SAME resource — that's the "user navigated back to
    // their own call's home page" case, which must not disturb anything.
    // Different-resource entry is silently refused; the call surface is
    // expected to render a busy screen using `descriptor` to detect the
    // mismatch. We refuse here because mutating `source` mid-call would
    // desynchronise the descriptor from the live RTK client.
    if (sameResource) return;

    if (import.meta.env.DEV) {
      console.warn(
        "[useCallSession] enterLobby refused: another call is active",
        {
          active: active?.descriptor.resourceId,
          requested: next.descriptor.resourceId,
          status: state.status,
        },
      );
    }
  };

  const joinCall = async (prefs: CallJoinPreferences): Promise<void> => {
    const port = sourceRef.current;
    if (!port) return;

    dispatch({ type: "JOIN_REQUESTED" });

    let mintedToken:
      | { authToken: string; meetingId: string; transcribe?: boolean }
      | null = null;
    try {
      mintedToken = await port.acquireToken(prefs);
      dispatch({ type: "TOKEN_OK", ...mintedToken });
    } catch (err) {
      console.error("Failed to acquire call token:", err);
      const { message } = classifyError(err);
      dispatch({ type: "JOIN_FAILED", reason: "token-failed", message });
      return;
    }

    if (initRunning.current) return;
    initRunning.current = true;
    let m: RTKClient | undefined;
    try {
      const { default: RTKClientCtor } = await import("@cloudflare/realtimekit");
      m = await RTKClientCtor.init({
        authToken: mintedToken.authToken,
        defaults: { audio: prefs.audioEnabled, video: prefs.videoEnabled },
      });
      setMeeting(m);
    } catch (err) {
      console.error("Failed to init RTK client:", err);
      const { message } = classifyError(err);
      dispatch({ type: "JOIN_FAILED", reason: "rtk-init-failed", message });
      return;
    } finally {
      initRunning.current = false;
    }

    if (!m) return;

    try {
      await m.join();

      if (prefs.audioDeviceId) {
        const audioDevices = await m.self.getAudioDevices();
        const selected = audioDevices.find(
          (d: { deviceId: string }) => d.deviceId === prefs.audioDeviceId,
        );
        if (selected) await m.self.setDevice(selected);
      }
      if (prefs.videoDeviceId) {
        const videoDevices = await m.self.getVideoDevices();
        const selected = videoDevices.find(
          (d: { deviceId: string }) => d.deviceId === prefs.videoDeviceId,
        );
        if (selected) await m.self.setDevice(selected);
      }

      dispatch({ type: "RTK_JOINED" });
    } catch (err) {
      console.error("Failed to join RTK meeting:", err);
      const { message } = classifyError(err);
      dispatch({ type: "JOIN_FAILED", reason: "rtk-join-failed", message });
    }
  };

  const leaveCall = async (): Promise<void> => {
    const m = meetingRef.current;
    const port = sourceRef.current;

    dispatch({ type: "LEAVE_REQUESTED" });

    if (m) {
      try {
        await m.leave();
        const remaining = m.participants.joined.toArray().length;
        if (port?.onAfterLeave) {
          await port.onAfterLeave({ remainingParticipants: remaining });
        }
      } catch (err) {
        // Leave failures aren't user-facing — the local UI is going away
        // anyway. Log + proceed to cleanup.
        console.error("Failed to leave RTK meeting:", err);
      }
    }

    dispatch({ type: "RTK_LEFT" });
    setMeeting(null);
    setSource(null);
  };

  const reset = (): void => {
    dispatch({ type: "RESET" });
    setMeeting(null);
    setSource(null);
  };

  // Tab close / provider unmount: best-effort RTK cleanup. Mirrors the
  // existing ActiveCallContext behaviour — we don't await this; the tab
  // is going away regardless.
  useEffect(() => {
    return () => {
      const m = meetingRef.current;
      if (m) void m.leave();
    };
  }, []);

  return { state, source, meeting, enterLobby, joinCall, leaveCall, reset };
}
