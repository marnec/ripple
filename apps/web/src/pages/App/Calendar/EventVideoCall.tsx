import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { RtkParticipantsAudio } from "@cloudflare/realtimekit-react-ui";
import { useAction } from "convex/react";
import { LogOut, Monitor, MonitorOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useViewer } from "../UserContext";
import { CallLobby, type DevicePreferences } from "../GroupVideoCall/CallLobby";
import { CameraToggle, MicToggle } from "../GroupVideoCall/MediaToggle";
import { VideoTile } from "../GroupVideoCall/VideoTile";

/**
 * Authenticated calendar-event call surface.
 *
 * v1 deliberately does NOT integrate with ActiveCallContext (the floating
 * PIP / channel-bound state machine) — that context is heavily keyed on
 * channelId, and event calls can be standalone. We trade away the
 * "navigate-while-in-call" PIP feature in exchange for a simpler,
 * isolated implementation. If the feature is requested for events later,
 * extend ActiveCallContext to take an `eventId | channelId` discriminated
 * union and reuse the lobby/PIP code from there.
 *
 * The CallLobby device-picker step is also skipped for now; we join with
 * audio/video off and let the user toggle them inside the meeting.
 */
export function EventVideoCall() {
  const { workspaceId, eventId } = useParams<QueryParams & { eventId?: string }>();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;

  // QueryParams already types workspaceId as Id<"workspaces">; only eventId
  // (which we added via the extension type) needs branding.
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
  const joinEventCall = useAction(api.calendarEvents.joinEventCall);
  const [meeting, initMeeting] = useRealtimeKitClient();
  // "lobby" is the new initial state — same UX as the channel call flow,
  // where CallLobby lets the user pick devices + toggle mic/cam before
  // they actually issue a Cloudflare token. Skipping straight to
  // "joining" was the old behaviour and matched what guests get, but
  // authenticated members are entitled to the device-picker step.
  const [status, setStatus] = useState<
    "lobby" | "joining" | "joined" | "error" | "left"
  >("lobby");
  const [error, setError] = useState<string | null>(null);
  const meetingRef = useRef(meeting);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  // Leave on unmount.
  useEffect(() => {
    return () => {
      const m = meetingRef.current;
      if (m) void m.leave();
    };
  }, []);

  const handleBack = () => {
    void navigate(`/workspaces/${workspaceId}/dashboard/calendar`);
  };

  // User clicked Join in the lobby: now we issue the participant token,
  // initialise the meeting client with their device prefs, and apply the
  // chosen mic/cam if any. Mirrors ActiveCallContext.joinCall (channels)
  // — kept inline rather than refactoring that context to accept events,
  // which would be a much bigger change. No StrictMode double-fire risk
  // here because this only runs from a user click, not on mount.
  const handleJoin = async (prefs: DevicePreferences) => {
    setStatus("joining");
    try {
      const { authToken } = await joinEventCall({
        eventId,
        userName: prefs.userName ?? user?.name ?? "Anonymous",
        userImage: prefs.userImage ?? user?.image ?? undefined,
      });
      const m = await initMeeting({
        authToken,
        defaults: { audio: prefs.audioEnabled, video: prefs.videoEnabled },
      });
      if (!m) return;
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
      setStatus("joined");
    } catch (err) {
      console.error("Failed to join event call:", err);
      setError(err instanceof Error ? err.message : "Failed to join call");
      setStatus("error");
    }
  };

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-destructive">{error ?? "Something went wrong"}</p>
        <Button variant="outline" onClick={handleBack}>Back to calendar</Button>
      </div>
    );
  }

  if (status === "left") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">You left the call</h1>
        <Button variant="outline" onClick={handleBack}>Back to calendar</Button>
      </div>
    );
  }

  if (status === "lobby") {
    return (
      <CallLobby
        userName={user?.name ?? "You"}
        onJoin={(prefs) => void handleJoin(prefs)}
        onBack={handleBack}
      />
    );
  }

  if (!meeting || status !== "joined") {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner size={64} />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <RealtimeKitProvider value={meeting}>
        <RtkParticipantsAudio meeting={meeting} />
        <MeetingRoom onLeave={() => setStatus("left")} />
      </RealtimeKitProvider>
    </div>
  );
}

// ── Tile/control components — same shape as the guest variants. Kept inline
//    rather than imported because GroupVideoCall's tiles are wired to
//    ActiveCallContext / FollowMode which we deliberately bypass here.

function MeetingRoom({ onLeave }: { onLeave: () => void }) {
  const { meeting } = useRealtimeKitMeeting();
  const participants = useRealtimeKitSelector((m) => m.participants.joined.toArray());

  const handleLeave = async () => {
    await meeting.leave();
    onLeave();
  };

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
      <ControlsBar onLeave={() => void handleLeave()} />
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

function ControlsBar({ onLeave }: { onLeave: () => void }) {
  const { meeting } = useRealtimeKitMeeting();
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
      <Button variant="destructive" onClick={onLeave} className="gap-2 h-11 md:h-9">
        <LogOut className="h-4 w-4" />
        Leave
      </Button>
    </div>
  );
}
