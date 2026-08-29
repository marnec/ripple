import { RealtimeKitProvider } from "@cloudflare/realtimekit-react";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";

import { CallBusyScreen } from "@/components/CallBusyScreen";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@ripple/ui/components/button";
import { useActiveCall } from "@/contexts/ActiveCallContext";
import { usePresence } from "@/contexts/WorkspacePresenceContext";
import { useChannelCalls } from "@/hooks/use-channel-calls";
import {
  isCallBusyForOtherResource,
  type CallSourcePort,
} from "@/lib/call/source-port";
import {
  CallLobby,
  type DevicePreferences,
  type ExistingCall,
} from "@/pages/App/GroupVideoCall/CallLobby";
import { useViewer } from "@/pages/App/UserContext";

import { CallControlsBar } from "./ControlsBar";
import { CallMeetingGrid } from "./MeetingGrid";
import type { CallParticipant } from "./types";

interface CallSurfaceProps {
  /**
   * Source port for this call. Built by a kind-specific factory hook
   * (`useChannelCallSource`, `useEventCallSource`). The surface is
   * polymorphic over kinds via this single prop.
   */
  source: CallSourcePort;
  /**
   * The resource id (channelId or eventId) this surface is bound to.
   * Compared against the active call's descriptor to decide between the
   * "render meeting", "render lobby", and "render busy screen" branches.
   */
  resourceId: string;
  /** Back-button shown on lobby + error screens. */
  back: { label: string; onClick: () => void };
  /**
   * Surface-specific control rendered inside the controls bar at the
   * bottom of the joined meeting, alongside mic/camera/screen-share.
   * Hidden on lobby/error/busy. Channel calls use this for the
   * admin-only share-call button.
   */
  controlsTrailing?: ReactNode;
  /**
   * Per-tile decoration rendered as overlay children of each remote
   * participant tile. Receives the participant; return `null` to skip.
   * Channel calls use this for the follow-mode hover button.
   */
  renderParticipantOverlay?: (participant: CallParticipant) => ReactNode;
}

/**
 * Polymorphic call surface. Renders the busy / error / lobby / loading /
 * joined branches based on `useActiveCall()`. Both channel and event
 * routes mount this with their own source factory and chrome — there's
 * one render switch in the codebase, here.
 */
export function CallSurface({
  source,
  resourceId,
  back,
  controlsTrailing,
  renderParticipantOverlay,
}: CallSurfaceProps) {
  const callCtx = useActiveCall();
  const user = useViewer();

  // Is a call already running here? Presence rather than the `callSessions`
  // row, for the reason `use-channel-calls` documents: the row is only cleared
  // by a clean last-participant leave, so it lights a channel up forever.
  //
  // `isConnected` is what separates "presence says nobody is here" from
  // "presence has not told us yet". Without it a socket still opening looks
  // exactly like an empty channel, and we would offer to start a call that is
  // already running — the one wrong answer, since it hands the joiner a
  // transcription toggle whose value the server will discard.
  const { isConnected } = usePresence();
  const channelCalls = useChannelCalls();
  const existingCall: ExistingCall = (() => {
    // Event calls do not publish a call channel to presence, so there is no
    // signal to read. Say so rather than guessing "none".
    if (source.descriptor.kind !== "channel") return { state: "unknown" };
    if (!isConnected) return { state: "unknown" };
    const call = channelCalls.get(resourceId);
    if (!call || call.participants.length === 0) return { state: "none" };
    return { state: "present", transcribing: call.transcribing };
  })();

  const busyForOther = isCallBusyForOtherResource(
    callCtx.descriptor,
    callCtx.status,
    resourceId,
  );

  // Skip enterLobby when (a) we're already joined for THIS resource — the
  // user clicked "return to call" from PiP — or (b) another call is
  // active. Both gates also live in `useCallSession`; the duplication
  // here documents intent and avoids a noisy dev-only warn.
  useEffect(() => {
    if (busyForOther) return;
    const sameJoined =
      callCtx.status === "joined" &&
      callCtx.descriptor?.resourceId === resourceId;
    if (!sameJoined) {
      callCtx.enterLobby(source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, busyForOther]);

  // What we believed at the moment Join was pressed, so the transition into
  // `joined` can be compared against what the server actually did. Cleared on
  // read — a "return to call" from PiP arrives already joined and must not
  // replay the toast.
  const joinIntentRef = useRef<{
    joinedExisting: boolean;
    requested: boolean;
  } | null>(null);

  const handleJoin = (prefs: DevicePreferences) => {
    joinIntentRef.current = {
      joinedExisting: existingCall.state === "present",
      requested: prefs.transcribe ?? false,
    };
    void callCtx.joinCall({
      ...prefs,
      userName: prefs.userName ?? user?.name ?? "Anonymous",
      userImage: prefs.userImage ?? user?.image ?? undefined,
    });
  };

  // Transcription is decided by whoever starts the call, so joining one means
  // inheriting a setting you did not choose. Say which, every time, rather than
  // only on a mismatch: staying silent when the inherited mode happens to match
  // what you picked teaches you the control was yours, and the next call — where
  // it differs — then looks like a bug.
  //
  // The mismatch branch is the safety net for the case presence cannot see: a
  // call attended only by share-link guests reports no participants, so the
  // lobby offers to start one and the server hands over the live meeting
  // instead. `joinCall` returns the authoritative mode either way.
  useEffect(() => {
    if (callCtx.status !== "joined") return;
    const intent = joinIntentRef.current;
    if (!intent) return;
    joinIntentRef.current = null;

    const actual = callCtx.isTranscribing;
    if (intent.joinedExisting) {
      toast.info(
        actual
          ? "This call is being transcribed — set by whoever started it."
          : "This call is not being transcribed — set by whoever started it.",
      );
    } else if (actual !== intent.requested) {
      toast.info(
        actual
          ? "This call was already running and is being transcribed."
          : "This call was already running and is not being transcribed.",
      );
    }
  }, [callCtx.status, callCtx.isTranscribing]);

  if (busyForOther) {
    return <CallBusyScreen requestedSource={source} />;
  }

  if (callCtx.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-destructive">{callCtx.error ?? "Something went wrong"}</p>
        <Button variant="outline" onClick={back.onClick}>
          {back.label}
        </Button>
      </div>
    );
  }

  if (
    callCtx.status === "joined" &&
    callCtx.meeting &&
    callCtx.descriptor?.resourceId === resourceId
  ) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <RealtimeKitProvider value={callCtx.meeting}>
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <CallMeetingGrid renderParticipantOverlay={renderParticipantOverlay} />
            </div>
            <CallControlsBar trailing={controlsTrailing} />
          </div>
        </RealtimeKitProvider>
      </div>
    );
  }

  // Leaving — the user hit Leave and we're navigating away. `status` reads
  // `idle` here, but rendering the lobby would flash the join screen on the
  // way out, so show the transition spinner instead.
  if (callCtx.isLeaving) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner size={64} />
      </div>
    );
  }

  if (callCtx.status === "lobby" || callCtx.status === "idle") {
    return (
      <CallLobby
        userName={user?.name ?? "You"}
        existingCall={existingCall}
        onJoin={handleJoin}
        onBack={back.onClick}
      />
    );
  }

  // Joining — between lobby and joined.
  return (
    <div className="flex h-full items-center justify-center">
      <RippleSpinner size={64} />
    </div>
  );
}
