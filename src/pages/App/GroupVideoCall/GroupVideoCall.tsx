import {
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { Eye, LogOut, Monitor, MonitorOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useViewer } from "../UserContext";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import { useActiveCall } from "../../../contexts/ActiveCallContext";
import { useFollowMode } from "../../../contexts/FollowModeContext";
import { RippleSpinner } from "../../../components/RippleSpinner";
import { CallLobby } from "./CallLobby";
import { CameraToggle, MicToggle } from "./MediaToggle";
import { VideoTile } from "./VideoTile";

// --- Participant video tile ---

function ParticipantTile({
  participant,
}: {
  participant: {
    id: string;
    name: string;
    picture: string;
    videoEnabled: boolean;
    audioEnabled: boolean;
    videoTrack: MediaStreamTrack;
    customParticipantId?: string;
    registerVideoElement: (el: HTMLVideoElement) => void;
    deregisterVideoElement: (el?: HTMLVideoElement) => void;
  };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { startFollowing, isFollowing, followingUserId } = useFollowMode();

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    participant.registerVideoElement(el);
    return () => {
      participant.deregisterVideoElement(el);
    };
  }, [participant, participant.videoTrack]);

  const participantUserId = participant.customParticipantId;
  const isFollowingThis = isFollowing && followingUserId === participantUserId;

  return (
    <VideoTile.Root className="group">
      {participant.videoEnabled ? (
        <VideoTile.Video videoRef={videoRef} />
      ) : (
        <VideoTile.AvatarFallback name={participant.name} />
      )}
      <VideoTile.NameBadge
        name={participant.name || "Participant"}
        muted={!participant.audioEnabled}
      />
      {participantUserId && !isFollowingThis && (
        <button
          className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          onClick={() =>
            startFollowing(
              participantUserId as Id<"users">,
              participant.name || "Participant",
            )
          }
          title={`Follow ${participant.name}`}
        >
          <Eye className="h-3 w-3" />
          Follow
        </button>
      )}
      {isFollowingThis && (
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-blue-500/80 px-2 py-1 text-xs text-white">
          <Eye className="h-3 w-3" />
          Following
        </div>
      )}
    </VideoTile.Root>
  );
}

// --- Self video tile ---

function SelfTile() {
  const { meeting } = useRealtimeKitMeeting();
  const videoEnabled = useRealtimeKitSelector(
    (m) => m.self.videoEnabled,
  );
  const videoTrack = useRealtimeKitSelector(
    (m) => m.self.videoTrack,
  );
  const audioEnabled = useRealtimeKitSelector(
    (m) => m.self.audioEnabled,
  );
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
      <VideoTile.NameBadge
        name={`${name || "You"} (You)`}
        muted={!audioEnabled}
      />
    </VideoTile.Root>
  );
}

// --- Video grid ---

function VideoGrid() {
  const participants = useRealtimeKitSelector((m) =>
    m.participants.joined.toArray(),
  );

  return (
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
  );
}

// --- Controls bar ---

function ControlsBar() {
  const { meeting } = useRealtimeKitMeeting();
  const { leaveCall } = useActiveCall();
  const audioEnabled = useRealtimeKitSelector(
    (m) => m.self.audioEnabled,
  );
  const videoEnabled = useRealtimeKitSelector(
    (m) => m.self.videoEnabled,
  );
  const screenShareEnabled = useRealtimeKitSelector(
    (m) => m.self.screenShareEnabled,
  );

  const toggleAudio = async () => {
    if (audioEnabled) {
      await meeting.self.disableAudio();
    } else {
      await meeting.self.enableAudio();
    }
  };

  const toggleVideo = async () => {
    if (videoEnabled) {
      await meeting.self.disableVideo();
    } else {
      await meeting.self.enableVideo();
    }
  };

  const toggleScreenShare = async () => {
    if (screenShareEnabled) {
      await meeting.self.disableScreenShare();
    } else {
      await meeting.self.enableScreenShare();
    }
  };

  return (
    <div className="flex items-center justify-center gap-3 border-t bg-background px-4 py-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
      <MicToggle
        enabled={audioEnabled}
        onToggle={() => void toggleAudio()}
      />
      <CameraToggle
        enabled={videoEnabled}
        onToggle={() => void toggleVideo()}
      />
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

// --- Meeting room (once joined) ---

function MeetingRoom() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <VideoGrid />
      </div>
      <ControlsBar />
    </div>
  );
}

// --- Main component ---

const GroupVideoCall = ({
  channelId,
  workspaceId,
}: {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
}) => {
  const user = useViewer();
  const callCtx = useActiveCall();
  const navigate = useNavigate();

  // Enter lobby when component mounts (if not already in a call for this channel)
  useEffect(() => {
    if (callCtx.status === "idle" || (callCtx.channelId !== channelId && callCtx.status !== "joined")) {
      callCtx.enterLobby(channelId, workspaceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, workspaceId]);

  const handleBack = () => {
    void navigate(
      `/workspaces/${workspaceId}/channels/${channelId}`,
    );
  };

  const handleJoin = (prefs: { audioEnabled: boolean; videoEnabled: boolean; audioDeviceId?: string; videoDeviceId?: string }) => {
    void callCtx.joinCall({
      ...prefs,
      userName: user?.name || "Anonymous",
      userImage: user?.image ?? undefined,
    });
  };

  // If already joined this channel's call (e.g., returning from floating), show meeting room
  if (callCtx.status === "joined" && callCtx.meeting && callCtx.channelId === channelId) {
    return (
      <div className="h-full w-full overflow-hidden">
        <RealtimeKitProvider value={callCtx.meeting}>
          <MeetingRoom />
        </RealtimeKitProvider>
      </div>
    );
  }

  if (callCtx.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-destructive">{callCtx.error}</p>
        <Button variant="outline" onClick={handleBack}>
          Back to channel
        </Button>
      </div>
    );
  }

  if (callCtx.status === "lobby" || callCtx.status === "idle") {
    return (
      <CallLobby
        userName={user?.name || "You"}
        onJoin={handleJoin}
        onBack={handleBack}
      />
    );
  }

  // Joining state
  return (
    <div className="flex h-full items-center justify-center">
      <RippleSpinner size={96} />
    </div>
  );
};

export default GroupVideoCall;
