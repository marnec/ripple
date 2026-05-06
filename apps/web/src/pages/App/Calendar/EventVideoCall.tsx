import {
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { LogOut, Monitor, MonitorOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useParams } from "react-router-dom";
import { CallBusyScreen } from "@/components/CallBusyScreen";
import { useActiveCall } from "@/contexts/ActiveCallContext";
import { isCallBusyForOtherResource } from "@/lib/call/source-port";
import { useEventCallSource } from "@/lib/call/sources/event";
import { useViewer } from "../UserContext";
import { CallLobby, type DevicePreferences } from "../GroupVideoCall/CallLobby";
import { CameraToggle, MicToggle } from "../GroupVideoCall/MediaToggle";
import { VideoTile } from "../GroupVideoCall/VideoTile";

/**
 * Authenticated calendar-event call surface.
 *
 * Drives the same `ActiveCallContext` lifecycle as channel calls — the
 * provider is source-agnostic and reads navigation paths from the
 * `CallSourceDescriptor` an event source supplies. That's what makes the
 * floating PiP work for events: when the user leaves this page mid-call,
 * `isFloating` flips on the descriptor's `homePath` mismatch and the
 * globally-mounted FloatingCallWindow renders.
 *
 * Tile/control components are duplicated from GroupVideoCall (minus the
 * FollowMode follow-button) until UI deduplication ships separately.
 */
export function EventVideoCall() {
  const { workspaceId, eventId } = useParams<QueryParams & { eventId?: string }>();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;

  return (
    <EventVideoCallContent
      workspaceId={workspaceId}
      eventId={eventId as Id<"calendarEvents">}
    />
  );
}

function EventVideoCallContent({
  workspaceId,
  eventId,
}: {
  workspaceId: Id<"workspaces">;
  eventId: Id<"calendarEvents">;
}) {
  const user = useViewer();
  const navigate = useNavigate();
  const callCtx = useActiveCall();
  const eventSource = useEventCallSource(eventId, workspaceId);

  const busyForOther = isCallBusyForOtherResource(
    callCtx.descriptor,
    callCtx.status,
    eventId,
  );

  // Enter the lobby when this surface mounts. Same pattern as the
  // channel surface: skip if (a) we're already joined for this event
  // (user clicked "return to call" from PiP), or (b) another call is
  // active — the busy-screen branch below handles that UX.
  useEffect(() => {
    if (busyForOther) return;
    const sameEventJoined =
      callCtx.status === "joined" &&
      callCtx.descriptor?.resourceId === eventId;
    if (!sameEventJoined) {
      callCtx.enterLobby(eventSource);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, workspaceId, busyForOther]);

  const handleBack = () => {
    void navigate(`/workspaces/${workspaceId}/dashboard/calendar`);
  };

  const handleJoin = (prefs: DevicePreferences) => {
    void callCtx.joinCall({
      ...prefs,
      userName: prefs.userName ?? user?.name ?? "Anonymous",
      userImage: prefs.userImage ?? user?.image ?? undefined,
    });
  };

  // Another call is active for a different resource. Render the busy
  // screen — checked first so we never try to render call A's RTK
  // client on call B's page.
  if (busyForOther) {
    return <CallBusyScreen requestedSource={eventSource} />;
  }

  if (callCtx.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-destructive">{callCtx.error ?? "Something went wrong"}</p>
        <Button variant="outline" onClick={handleBack}>Back to calendar</Button>
      </div>
    );
  }

  if (
    callCtx.status === "joined" &&
    callCtx.meeting &&
    callCtx.descriptor?.resourceId === eventId
  ) {
    return (
      <div className="h-full w-full overflow-hidden">
        <RealtimeKitProvider value={callCtx.meeting}>
          <MeetingRoom />
        </RealtimeKitProvider>
      </div>
    );
  }

  if (callCtx.status === "lobby" || callCtx.status === "idle") {
    return (
      <CallLobby
        userName={user?.name ?? "You"}
        onJoin={handleJoin}
        onBack={handleBack}
      />
    );
  }

  // Joining state
  return (
    <div className="flex h-full items-center justify-center">
      <RippleSpinner size={64} />
    </div>
  );
}

// ── Tile / control components ───────────────────────────────────────────
// Same shape as GroupVideoCall's, minus FollowMode wiring (events don't
// participate in follow-mode for v1). Lifted into a shared component
// library when we ship UI deduplication.

function MeetingRoom() {
  const participants = useRealtimeKitSelector((m) =>
    m.participants.joined.toArray(),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <div
          className={`grid gap-3 ${
            participants.length === 0
              ? "grid-cols-1"
              : participants.length <= 1
                ? "grid-cols-1 sm:grid-cols-2"
                : participants.length <= 3
                  ? "grid-cols-2"
                  : "grid-cols-2 lg:grid-cols-3"
          }`}
        >
          <SelfTile />
          {participants.map((p) => (
            <ParticipantTile key={p.id} participant={p} />
          ))}
        </div>
      </div>
      <ControlsBar />
    </div>
  );
}

function SelfTile() {
  const { meeting } = useRealtimeKitMeeting();
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const videoTrack = useRealtimeKitSelector((m) => m.self.videoTrack);
  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const name = useRealtimeKitSelector((m) => m.self.name);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    meeting.self.registerVideoElement(el, true);
    return () => {
      meeting.self.deregisterVideoElement(el, true);
    };
  }, [meeting.self, videoTrack]);

  return (
    <VideoTile.Root>
      {videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} mirrored />
      ) : (
        <VideoTile.AvatarFallback name={name || "You"} />
      )}
      <VideoTile.NameBadge name={`${name || "You"} (You)`} muted={!audioEnabled} />
    </VideoTile.Root>
  );
}

function ParticipantTile({
  participant,
}: {
  participant: {
    id: string;
    name: string;
    videoEnabled: boolean;
    audioEnabled: boolean;
    videoTrack: MediaStreamTrack;
    registerVideoElement: (el: HTMLVideoElement) => void;
    deregisterVideoElement: (el?: HTMLVideoElement) => void;
  };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    participant.registerVideoElement(el);
    return () => {
      participant.deregisterVideoElement(el);
    };
  }, [participant, participant.videoTrack]);

  return (
    <VideoTile.Root>
      {participant.videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} />
      ) : (
        <VideoTile.AvatarFallback name={participant.name} />
      )}
      <VideoTile.NameBadge
        name={participant.name || "Participant"}
        muted={!participant.audioEnabled}
      />
    </VideoTile.Root>
  );
}

function ControlsBar() {
  const { meeting } = useRealtimeKitMeeting();
  const { leaveCall } = useActiveCall();
  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const screenShareEnabled = useRealtimeKitSelector((m) => m.self.screenShareEnabled);

  const toggleAudio = async () => {
    if (audioEnabled) await meeting.self.disableAudio();
    else await meeting.self.enableAudio();
  };
  const toggleVideo = async () => {
    if (videoEnabled) await meeting.self.disableVideo();
    else await meeting.self.enableVideo();
  };
  const toggleScreenShare = async () => {
    if (screenShareEnabled) await meeting.self.disableScreenShare();
    else await meeting.self.enableScreenShare();
  };

  return (
    <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
      <MicToggle enabled={audioEnabled} onToggle={() => void toggleAudio()} />
      <CameraToggle enabled={videoEnabled} onToggle={() => void toggleVideo()} />
      <Button
        variant={screenShareEnabled ? "destructive" : "secondary"}
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={() => void toggleScreenShare()}
        title={screenShareEnabled ? "Stop sharing" : "Share screen"}
      >
        {screenShareEnabled ? (
          <MonitorOff className="h-5 w-5" />
        ) : (
          <Monitor className="h-5 w-5" />
        )}
      </Button>
      <Button
        variant="destructive"
        onClick={() => void leaveCall()}
        className="gap-2 h-11 md:h-9"
      >
        <LogOut className="h-4 w-4" />
        Leave
      </Button>
    </div>
  );
}
