import { RealtimeKitProvider } from "@cloudflare/realtimekit-react";
import { useEffect, type ReactNode } from "react";

import { CallBusyScreen } from "@/components/CallBusyScreen";
import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { useActiveCall } from "@/contexts/ActiveCallContext";
import {
  isCallBusyForOtherResource,
  type CallSourcePort,
} from "@/lib/call/source-port";
import {
  CallLobby,
  type DevicePreferences,
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

  const handleJoin = (prefs: DevicePreferences) => {
    void callCtx.joinCall({
      ...prefs,
      userName: prefs.userName ?? user?.name ?? "Anonymous",
      userImage: prefs.userImage ?? user?.image ?? undefined,
    });
  };

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

  if (callCtx.status === "lobby" || callCtx.status === "idle") {
    return (
      <CallLobby
        userName={user?.name ?? "You"}
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
