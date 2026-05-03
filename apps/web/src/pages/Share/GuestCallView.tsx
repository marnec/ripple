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
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { CameraToggle, MicToggle } from "@/pages/App/GroupVideoCall/MediaToggle";
import { VideoTile } from "@/pages/App/GroupVideoCall/VideoTile";

interface GuestCallViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
}

/**
 * Standalone call surface for guests. Unlike workspace-member calls, guests
 * never enter `ActiveCallContext` or `FollowModeContext` — the host app only
 * provides those inside the authenticated shell. We initialise RealtimeKit
 * directly with the token issued by `getGuestCallToken`.
 *
 * Deliberately minimal: no lobby with device pickers, no "follow another
 * participant" affordance, no floating PIP. Leaving the call closes the tab
 * or navigates back.
 */
export function GuestCallView({ shareId, guestSub, guestName }: GuestCallViewProps) {
  const getGuestCallToken = useAction(api.shares.getGuestCallToken);
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [status, setStatus] = useState<"joining" | "joined" | "error" | "left">(
    "joining",
  );
  const [error, setError] = useState<string | null>(null);
  const meetingRef = useRef(meeting);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  // Fetch guest token + join the meeting once per guest session.
  // useRef prevents React 19 StrictMode double-invoke from issuing two tokens.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const { authToken } = await getGuestCallToken({
          shareId,
          guestSub,
          guestName,
        });
        if (cancelled) return;
        const m = await initMeeting({
          authToken,
          defaults: { audio: false, video: false },
        });
        if (cancelled) return;
        if (m) {
          await m.join();
          if (cancelled) return;
          setStatus("joined");
        }
      } catch (err) {
        console.error("Failed to join guest call:", err);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to join call");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getGuestCallToken, initMeeting, shareId, guestSub, guestName]);

  // Leave the meeting if the component unmounts
  useEffect(() => {
    return () => {
      const m = meetingRef.current;
      if (m) void m.leave();
    };
  }, []);

  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-destructive">{error ?? "Something went wrong"}</p>
      </div>
    );
  }

  if (status === "left") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">You left the call</h1>
        <p className="text-sm text-muted-foreground">You can close this tab.</p>
      </div>
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
        <GuestMeetingRoom onLeave={() => setStatus("left")} />
      </RealtimeKitProvider>
    </div>
  );
}

function GuestMeetingRoom({ onLeave }: { onLeave: () => void }) {
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
          <GuestSelfTile />
          {participants.map((p) => (
            <GuestParticipantTile key={p.id} participant={p} />
          ))}
        </div>
      </div>
      <GuestControlsBar onLeave={() => void handleLeave()} />
    </div>
  );
}

function GuestSelfTile() {
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

function GuestParticipantTile({
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

function GuestControlsBar({ onLeave }: { onLeave: () => void }) {
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
